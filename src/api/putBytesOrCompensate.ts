import { httpsUrlOrNull } from '../lib/httpsUrl';

/**
 * PUT the bytes for a document row that ALREADY EXISTS, and compensate that row if the transfer
 * fails. Exported and taken as a parameter rather than inlined in the mutation so the error a caller
 * actually receives is observable: the whole point of the `try`/`catch` below is WHICH error
 * survives, and the dialog renders identical copy for every failure, so a test driving it through
 * the DOM cannot tell the two apart.
 */
export async function putBytesOrCompensate(
  created: {
    readonly id?: string | undefined;
    readonly uploadUrl?: string | undefined;
    readonly created?: boolean | undefined;
    readonly requiredHeaders?: unknown;
    readonly requiredHeaderName?: unknown;
    readonly requiredHeaderValue?: unknown;
  },
  file: File,
  fileType: string,
  deleteDocument: (args: { id: string }) => Promise<unknown>,
): Promise<void> {
  try {
    // The URL came from the API and the bytes go to whatever it names, so only an https address is
    // used, and the value written to is the one that was checked.
    const uploadUrl = httpsUrlOrNull(created.uploadUrl);
    if (!uploadUrl) throw new Error('upload did not return an https presigned URL');
    // PUT the raw bytes straight to S3 — the presigned URL is self-authenticating, so NO
    // Authorization header (one would break the signature). Every header the response requires is
    // part of the signature, the Content-Type of a bound upload among them.
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: presignedPutHeaders(created, fileType),
      body: file,
    });
    if (!put.ok) throw new Error(`file upload failed: ${put.status}`);
  } catch (uploadError) {
    // uploadDocument() has already created the document row, so a failure here would otherwise
    // leave a document with no file in it, which the case's document list shows and nothing here
    // can remove.
    //
    // Compensate ONLY what this call minted. `created === true` is the API's own statement that it
    // created the document rather than returning one that already existed; `=== true` strictly,
    // because an absent flag means "cannot prove we made it" and must fall on the side of keeping
    // it. This dialog sends no externalId today, so a match is currently unreachable — the guard is
    // here so that adding one later cannot silently turn this line into a delete of a document the
    // user already had.
    if (created.created === true && created.id) {
      // Best effort, and a STATEMENT rather than a trailing `.catch()`: a client method that threw
      // synchronously would escape a `.catch`, skip the rethrow below, and replace the upload error
      // with a cleanup one.
      try {
        await deleteDocument({ id: created.id });
      } catch {
        // A credential may hold documents:c without documents:d. The original error is the one the
        // user needs either way.
      }
    }
    // NOTE: a `fetch` that REJECTS (network drop, missing CORS header) can still have transmitted
    // the body, so the object may exist. This deletes a document whose bytes did in fact land. The
    // client cannot tell the two apart, and leaving a phantom is the worse default.
    throw uploadError;
  }
}

/**
 * The headers a presigned upload URL requires, as named by the upload response.
 *
 * An upload that sent `size` is bound: the URL is signed for an exact length and `Content-Type`, and the response's
 * `requiredHeaders` map carries every header the PUT must send, that `Content-Type` among them (the media type as stored, which can
 * differ from the `fileType` sent). The platform can also bake an S3 conditional-write precondition (for example
 * `If-None-Match: *`, which makes the URL single-use) into the signature. A PUT that omits one of these, or changes its value,
 * fails signature validation with a 403 before the bytes are accepted.
 *
 * The map is used when present; otherwise the older single `requiredHeaderName`/`requiredHeaderValue` pair, so an API version
 * that does not return the map still works. Read from the response, never hard-coded, and checked at runtime.
 */
export function presignedUploadHeaders(response: {
  readonly requiredHeaders?: unknown;
  readonly requiredHeaderName?: unknown;
  readonly requiredHeaderValue?: unknown;
}): Record<string, string> {
  const { requiredHeaders, requiredHeaderName, requiredHeaderValue } = response;
  if (typeof requiredHeaders === 'object' && requiredHeaders !== null && !Array.isArray(requiredHeaders)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(requiredHeaders as Record<string, unknown>)) {
      if (k !== '' && typeof v === 'string') out[k] = v;
    }
    if (Object.keys(out).length > 0) return out;
  }
  if (typeof requiredHeaderName !== 'string' || requiredHeaderName === '') return {};
  if (typeof requiredHeaderValue !== 'string') return {};
  return { [requiredHeaderName]: requiredHeaderValue };
}

/**
 * The PUT's headers: the required ones, and `Content-Type: fileType` only when they do not name a `Content-Type` themselves (in
 * any letter case: two spellings of one header would be sent as one combined value, which no signature matches).
 */
export function presignedPutHeaders(
  response: Parameters<typeof presignedUploadHeaders>[0],
  fileType: string,
): Record<string, string> {
  const required = presignedUploadHeaders(response);
  const namesContentType = Object.keys(required).some((k) => k.toLowerCase() === 'content-type');
  return namesContentType ? required : { 'Content-Type': fileType, ...required };
}

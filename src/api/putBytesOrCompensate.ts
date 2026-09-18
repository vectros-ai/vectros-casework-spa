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
    readonly requiredHeaderName?: unknown;
    readonly requiredHeaderValue?: unknown;
  },
  file: File,
  fileType: string,
  deleteDocument: (args: { id: string }) => Promise<unknown>,
): Promise<void> {
  try {
    if (!created.uploadUrl) throw new Error('upload did not return a presigned URL');
    // PUT the raw bytes straight to S3 — the presigned URL is self-authenticating, so NO
    // Authorization header (one would break the signature). Content-Type must match the fileType
    // we declared, and any header the response requires is part of the signature too.
    const put = await fetch(created.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': fileType, ...presignedUploadHeaders(created) },
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
 * The extra header a presigned upload URL requires, as named by the upload response.
 *
 * The platform can bake an S3 conditional-write precondition (for example `If-None-Match: *`, which
 * makes the URL single-use) into the URL's own signature. A PUT that omits that header, or changes
 * its value, fails signature validation with a 403 before the bytes are accepted.
 *
 * Read from the response, never hard-coded, and only when the response carries a name: an API
 * version that does not return these fields gets no extra header, exactly as before. Checked at
 * runtime because the client library in use may predate the fields and so cannot type them.
 */
export function presignedUploadHeaders(response: {
  readonly requiredHeaderName?: unknown;
  readonly requiredHeaderValue?: unknown;
}): Record<string, string> {
  const { requiredHeaderName, requiredHeaderValue } = response;
  if (typeof requiredHeaderName !== 'string' || requiredHeaderName === '') return {};
  if (typeof requiredHeaderValue !== 'string') return {};
  return { [requiredHeaderName]: requiredHeaderValue };
}

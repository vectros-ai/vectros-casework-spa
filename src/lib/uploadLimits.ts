// ---------------------------------------------------------------------------
// Shared upload limits — the client-side file-size guard for case-document
// upload.
// ---------------------------------------------------------------------------

/**
 * Mirrors the backend's max file size (100 MB). The presigned PUT carries no
 * content-length condition, so without this guard an oversize file uploads
 * "successfully" then silently lands in FAILED at index time with no in-app
 * explanation — reject it up front instead.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

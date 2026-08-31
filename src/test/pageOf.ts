// ---------------------------------------------------------------------------
// pageOf — a single, FINAL `{ data, nextCursor: null }` page envelope, the
// shape every list endpoint returns. Keeps mocks faithful to the SDK's real
// response shape so a page's `.data` unwrap is actually exercised.
// ---------------------------------------------------------------------------

export function pageOf<T>(data: readonly T[]): { data: readonly T[]; nextCursor: null } {
  return { data, nextCursor: null };
}

// ---------------------------------------------------------------------------
// drainPages — exhaustively page a cursor-paginated Vectros SDK list endpoint.
//
// `listRecords` returns the `{ data, nextCursor }` page envelope: at most 20
// items by default plus a `nextCursor` that is null on the final page.
// `CasesListPage`'s per-org fan-out (`fetchAllCasesForOrg`) needs every case
// for an org, not just its first page, so it drains through this rather than
// taking one call at face value — an org with more than 20 cases would
// otherwise silently lose everything past the first page.
//
// Two rules the shape depends on, both easy to get wrong:
//
//  1. NEVER terminate on a short or empty page. Server-side scope filtering
//     (`filterByDataScope`, narrowing a case-handler's view down from the
//     org-wide page) is applied AFTER that page's cursor is captured, so a
//     page can come back short — or completely empty — with rows still
//     behind it. Stopping on `data.length < limit` re-introduces exactly the
//     silent truncation this paginator exists to prevent. Only a null cursor
//     ends it.
//
//  2. The bound counts PAGES, and it FAILS CLOSED. Do not reach for a
//     new-cursor-vs-previous-cursor comparison as a no-progress guard: the
//     cursor is sealed with a fresh nonce per seal, so two cursors for the
//     same position never compare equal and the test is permanently false —
//     a guard that reads as defensive while guarding nothing. Counting pages
//     is the only bound coupled to what the loop advances on, and on hitting
//     it we THROW rather than return what we have: a partial case list
//     handed back silently is worse than an error.
//
//     ⚠️ The bound must allow ONE MORE REQUEST than it allows pages of data.
//     A listing of exactly `maxPages × limit` rows fills every page, and a
//     FULL page still carries a live cursor — the server sets one whenever it
//     stops on `limit`, because it cannot know the next read is empty. The
//     extra request is the probe that distinguishes "exhausted" from "more to
//     come"; a drain that never spends it cannot tell those apart at the
//     boundary.
// ---------------------------------------------------------------------------

/** A single page: the items plus the opaque next-page cursor (null when exhausted). */
export interface CursorPage<T> {
  readonly data?: readonly T[] | undefined;
  readonly nextCursor?: (string | null) | undefined;
}

/** Default safety ceiling on pages drained (guards a cursor that never goes null). */
const DEFAULT_MAX_PAGES = 50;

/**
 * Drain every page of a cursor-paginated list endpoint into one array.
 *
 * `fetchPage(startFrom)` returns one `{ data, nextCursor }` page (`startFrom` is
 * `undefined` on the first call). We follow `nextCursor` until it is
 * null/absent, which is the ONLY terminal condition — a short or empty page
 * with a live cursor is normal and the drain continues through it.
 *
 * @param fetchPage fetch a single page given the previous page's cursor (undefined on the first page)
 * @param maxPages  how many pages are chased before the drain refuses (default
 *                  50). Note this is NOT a bound on rows accumulated: the final
 *                  iteration is usually the terminal probe, but a listing that
 *                  ends exactly there returns its data too, so a successful
 *                  drain can hold up to `(maxPages + 1) × limit` rows
 * @throws if the cursor is still live once that allowance is spent — the result
 *         would be partial, and a silently partial enumeration is the failure
 *         this paginator exists to prevent
 */
export async function drainPages<T>(
  fetchPage: (startFrom: string | undefined) => Promise<CursorPage<T>>,
  maxPages: number = DEFAULT_MAX_PAGES,
): Promise<T[]> {
  const all: T[] = [];
  let startFrom: string | undefined;
  // `<=`, not `<`: the final iteration is the terminal probe (see rule 2). A
  // full last page carries a live cursor, so bounding the REQUESTS rather than
  // the pages would fail a complete listing of exactly `maxPages × limit` rows.
  for (let page = 0; page <= maxPages; page++) {
    const { data, nextCursor } = await fetchPage(startFrom);
    if (data) all.push(...data);
    // Null or absent means exhausted. Nothing else ends the drain.
    //
    // A blank cursor is folded in here, and that IS an asymmetry in an
    // otherwise fail-closed function — it returns rather than throws. Echoing
    // `''` back is the worst option: the server reads a blank `startFrom` as
    // "no resume position" and restarts the listing at page one, so the drain
    // would never end. And no server path emits it — an empty key encodes as a
    // null cursor — so this branch is defensive only, and throwing on it would
    // convert an impossible response into a user-visible failure while proving
    // nothing.
    if (!nextCursor) return all;
    startFrom = nextCursor;
  }
  // Both numbers, because they describe different incidents: "5000 cases over
  // 51 requests" is a listing genuinely larger than the ceiling, "0 cases over
  // 51 requests" is a cursor that never resolves. Requests, not pages, because
  // that is the count actually made — the terminal probe is one of them.
  throw new Error(
    `drainPages: the listing is still not exhausted after ${maxPages + 1} requests ` +
      `(${all.length} items). Refusing to return a partial result.`,
  );
}

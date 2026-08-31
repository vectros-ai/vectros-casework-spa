// ---------------------------------------------------------------------------
// drainPages tests — the cursor-paginator behind `CasesListPage`'s per-org
// case fan-out. A regression here silently truncates or hangs the case list,
// so every termination branch is covered: null-cursor stop, absent-cursor
// stop, empty-string-cursor stop, the maxPages ceiling (which THROWS), an
// empty page that must NOT stop the drain, and cursor threading.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';

import { drainPages, type CursorPage } from './drainPages';

interface Item {
  readonly id: string;
}

/**
 * Build a fetchPage backed by fixed pages, recording the cursors it was called
 * with — and ENFORCING the cursor contract rather than merely observing it.
 *
 * The fetcher serves page N only when handed the cursor page N-1 issued, and
 * rejects anything else exactly as the API does (it authenticates the cursor and
 * answers a fabricated one with a 400). Walking an internal index instead would
 * serve the pages in order no matter what the paginator sent, so a drain that
 * invented its own `startFrom` would still pass — cursor correctness would rest
 * entirely on a `calls` equality assertion that a future edit could drop.
 */
function pagedFetcher(pages: ReadonlyArray<CursorPage<Item>>): {
  fetchPage: (startFrom: string | undefined) => Promise<CursorPage<Item>>;
  calls: Array<string | undefined>;
} {
  const calls: Array<string | undefined> = [];
  const fetchPage = (startFrom: string | undefined): Promise<CursorPage<Item>> => {
    calls.push(startFrom);
    const index =
      startFrom === undefined
        ? 0
        : pages.findIndex((_p, i) => i > 0 && pages[i - 1]?.nextCursor === startFrom);
    if (index < 0) {
      return Promise.reject(
        new Error(
          `400 invalid_cursor: ${JSON.stringify(startFrom)} is not a cursor this API issued`,
        ),
      );
    }
    return Promise.resolve(pages[index] ?? { data: [], nextCursor: null });
  };
  return { fetchPage, calls };
}

describe('drainPages', () => {
  it('follows nextCursor across pages and concatenates in order', async () => {
    const { fetchPage, calls } = pagedFetcher([
      { data: [{ id: 'a' }, { id: 'b' }], nextCursor: 'b' },
      { data: [{ id: 'c' }], nextCursor: null }, // null cursor → terminal
    ]);
    const result = await drainPages(fetchPage);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    // First page no cursor; second page seeded from page 1's nextCursor.
    expect(calls).toEqual([undefined, 'b']);
  });

  it('stops on an absent cursor (undefined) even when the page is full', async () => {
    const { fetchPage, calls } = pagedFetcher([
      { data: [{ id: 'a' }, { id: 'b' }] }, // no nextCursor field → exhausted
    ]);
    const result = await drainPages(fetchPage);
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
    expect(calls).toEqual([undefined]);
  });

  it('handles an empty first page', async () => {
    const { fetchPage, calls } = pagedFetcher([{ data: [], nextCursor: null }]);
    const result = await drainPages(fetchPage);
    expect(result).toEqual([]);
    expect(calls).toEqual([undefined]);
  });

  it('tolerates a page with no data array', async () => {
    const { fetchPage } = pagedFetcher([{ nextCursor: null }]);
    const result = await drainPages(fetchPage);
    expect(result).toEqual([]);
  });

  it('stops on an empty-string cursor rather than echoing it back', async () => {
    // Not because it "cannot" be echoed — it can. The server reads a blank
    // `startFrom` as "no resume position" and restarts the listing at page one,
    // so echoing it is precisely the input that would loop forever.
    const { fetchPage, calls } = pagedFetcher([{ data: [{ id: 'a' }], nextCursor: '' }]);
    const result = await drainPages(fetchPage);
    expect(result.map((i) => i.id)).toEqual(['a']);
    expect(calls).toEqual([undefined]);
  });

  it('does NOT stop on an empty page that still carries a live cursor', async () => {
    // The shape a case-handler's per-page `filterByDataScope` narrowing really
    // produces: server-side filtering is applied to each page AFTER that
    // page's cursor is captured, so a page can come back empty with rows
    // still behind it. Stopping here is silent truncation.
    const { fetchPage } = pagedFetcher([
      { data: [{ id: 'a' }], nextCursor: 'c1' },
      { data: [], nextCursor: 'c2' },
      { data: [{ id: 'b' }], nextCursor: null },
    ]);
    const result = await drainPages(fetchPage);
    expect(result.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('does NOT stop when consecutive cursors repeat — that guard was unreachable', async () => {
    // Cursors are sealed with a fresh nonce per seal, so two seals of the same
    // position never compare equal; a same-cursor test could never fire
    // against the real API. A repeat is therefore NOT a termination signal —
    // only the page ceiling below bounds this, and it throws.
    const fetchPage = vi.fn(() =>
      Promise.resolve<CursorPage<Item>>({ data: [{ id: 'x' }], nextCursor: 'same' }),
    );
    await expect(drainPages(fetchPage, 4)).rejects.toThrow(/not exhausted after 5 requests/);
    expect(fetchPage).toHaveBeenCalledTimes(5);
  });

  it('RETURNS when the cursor goes null on exactly page maxPages (boundary)', async () => {
    // A SHORT final page: the server keeps reading until it can null the
    // cursor, so this shape terminates inside the bound. Safe either way — it
    // is NOT the boundary that bites (see the next cell).
    const { fetchPage } = pagedFetcher([
      { data: [{ id: 'a' }], nextCursor: 'c1' },
      { data: [{ id: 'b' }], nextCursor: 'c2' },
      { data: [{ id: 'c' }], nextCursor: null },
    ]);
    const result = await drainPages(fetchPage, 3);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('RETURNS a listing of exactly maxPages FULL pages — the terminal probe is not charged to the bound', async () => {
    // THE boundary that bites, and the one the cell above cannot see. A full
    // page still carries a live cursor: the server sets one whenever it stops
    // on `limit`, because it cannot know the next read is empty. So proving
    // exhaustion costs one request beyond the last page of DATA.
    const { fetchPage, calls } = pagedFetcher([
      { data: [{ id: 'a' }], nextCursor: 'c1' },
      { data: [{ id: 'b' }], nextCursor: 'c2' },
      { data: [{ id: 'c' }], nextCursor: 'c3' }, // full + LIVE cursor
      { data: [], nextCursor: null }, // the probe: empty, and terminal
    ]);
    const result = await drainPages(fetchPage, 3);
    expect(result.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(calls).toEqual([undefined, 'c1', 'c2', 'c3']);
  });

  it('THROWS at the maxPages ceiling rather than returning a partial result', async () => {
    let n = 0;
    const fetchPage = vi.fn(() =>
      Promise.resolve<CursorPage<Item>>({ data: [{ id: `id-${n}` }], nextCursor: `c-${n++}` }),
    );
    await expect(drainPages(fetchPage, 3)).rejects.toThrow(
      /the listing is still not exhausted after 4 requests \(4 items\)/,
    );
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('names BOTH numbers so the two incidents are distinguishable', async () => {
    // "0 items over N pages" is a cursor that never resolves; "N*limit items
    // over N pages" is a listing genuinely bigger than the ceiling. A message
    // carrying only one of them cannot tell an operator which they have.
    const empties = vi.fn(() =>
      Promise.resolve<CursorPage<Item>>({ data: [], nextCursor: 'live' }),
    );
    await expect(drainPages(empties, 2)).rejects.toThrow(
      /not exhausted after 3 requests \(0 items\)/,
    );
  });
});

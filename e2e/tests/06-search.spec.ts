// ---------------------------------------------------------------------------
// Search: hr-admin's `/search` screen. Creates a fresh case with a distinctive
// entry, then searches for it.
//
// **Why this searches for the ENTRY text, not the case itself.** `case`'s own
// schema (`casework.blueprint.yaml`) declares no `searchable: true` field --
// it's structured data (an enum type, an enum status, dates), not prose -- so
// a `case` record's indexed free-text content is empty and it will never
// surface via a keyword/semantic query on its own. Only `case_note.body` is
// declared `searchable: true`. So the realistic, exercisable path is: add an
// entry with distinctive text, search for that text, find the entry.
//
// **A `case_note` result's link back to its case is BEST-EFFORT, not
// asserted unconditionally.** It depends on `case_note.caseId` being
// `filterable` in the DEPLOYED blueprint AND a reindex having run for this
// environment's data -- an operational precondition
// (re-apply the blueprint, per this app's own Quickstart step 3) this spec
// can't guarantee happened before it runs. If the link is present, this
// verifies it navigates correctly; if not, that's a known, accepted
// pre-blueprint-reapply state, not a spec failure -- see SearchPage.tsx's own
// header comment on the same best-effort resolve.
//
// **Real async-indexing lag, same shape `04-cases.spec.ts` already documents
// for optimistic-concurrency timing** -- HYBRID indexing runs AFTER create,
// and here it's the search-engine write specifically (not just the DDB
// version bump) that has to land before a query can find it. No deterministic
// UI signal to poll instead, so this retries the search itself on an empty
// result rather than guessing one fixed duration.
//
// **Keyword mode, not the Hybrid default, for the assertion search.** Live-caught running this
// spec: every `04-cases.spec.ts` run (and every prior run of THIS spec) leaves behind a case_note
// reading "Smoke-suite regression entry." -- worded closely enough to this spec's own marker text
// that Hybrid's semantic leg scores them all roughly equally (~29%, tied), and a fresh single-run
// marker can lose that tie and never surface on the first results page. A single unique,
// hyphen-free token has no such semantic neighbors -- Keyword mode's lexical match finds it
// precisely, not approximately.
//
// **The settle-check must match the EXACT marker, not just "a Case entry result exists."**
// Live-caught, a second time: every past run of THIS spec also leaves behind its own
// `smokemarker<timestamp>` entry (never deleted -- same accepted-clutter tradeoff
// `fixtures/testData.ts`'s own header documents for cases/invites), and Keyword mode's match
// turned out to be loose enough to surface an OLDER run's differently-timestamped marker as a
// "Case entry" hit before THIS run's own entry had actually finished indexing -- a generic
// "does a Case entry result exist" check reads that as success. Matching the full, unique marker
// string specifically is what actually proves THIS run's write landed.
//
// **A SECOND known, accepted low-frequency flake, same shape `04-cases.spec.ts`'s own status-
// change race already documents.** Measured directly (repeated live runs against staging while
// building this spec): the search-engine write for a freshly-created case_note can take well
// over a minute to land in this environment -- sometimes under 20s, sometimes past the 240s
// budget below. There's no deterministic signal to poll instead of retrying (same reasoning
// `04-cases.spec.ts` gives), and this is a real platform-timing characteristic, not a bug this
// app's own code can fix -- if this spec times out in CI, re-run rather than chase full
// determinism here.
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';
import { perFileAuth } from '../fixtures/authed';
import { SMOKE_ORG_A, SMOKE_CLIENT_A, createCaseForExistingClient, pickOrgIfPresent } from '../fixtures/testData';

test.use({ storageState: perFileAuth(test) });

/** Submits `query` and waits for it to surface as a real result, retrying the search itself
 *  while indexing catches up (see file header) -- returns `true` once a `<p>` containing the
 *  exact `query` text renders (the result card's snippet -- see the caller's own comment on why
 *  this must be the exact-marker locator, not a generic "a result exists" check), `false` if the
 *  budget (up to ~10 attempts, generous per-attempt waits -- live-caught running this spec: the
 *  search-engine write can take meaningfully longer to land than the DDB version bump
 *  `04-cases.spec.ts`'s own race accounts for) is exhausted first.
 *
 *  Waits for an actual TERMINAL state each attempt (the "No results" alert, or the exact-marker
 *  result), never just `networkidle` -- live-caught: `networkidle` can resolve before this app's
 *  own TanStack Query fetch has finished rendering (still showing the "Searching…" spinner),
 *  which made an earlier version of this helper wrongly read a still-loading page as "results
 *  already found" and return before anything had actually settled. */
async function searchUntilIndexed(
  page: import('@playwright/test').Page,
  query: string,
  attempts = 10,
): Promise<boolean> {
  const searchBox = page.getByRole('textbox', { name: 'Search' });
  const noResults = page.getByText(`No results for "${query}".`);
  // Scoped to a `<p>` (the result card's snippet, `Typography variant="body2"`) rather than a
  // bare page-wide getByText -- the latter also matches the search TEXTBOX's own typed-in value
  // (which literally contains `query` too), a false positive that would pass even on zero real
  // results. Live-caught: this is exactly what happened before this scoping was added.
  const found = page.locator('p', { hasText: query }).first();
  for (let attempt = 0; attempt < attempts; attempt++) {
    await searchBox.fill(query);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const settled = await Promise.race([
      found.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'found' as const).catch(() => null),
      noResults.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'empty' as const).catch(() => null),
    ]);
    if (settled === 'found') return true;
    if (settled === 'empty') await page.waitForTimeout(6_000);
    // `settled === null` (neither state showed up in time) -- retry too, no extra wait needed,
    // the two 15s `waitFor` calls already spent real time.
  }
  return false;
}

test.describe('search', () => {
  test('finds a fresh case entry by its distinctive text and shows a "Case entry" result', async ({ page }) => {
    // A generous ceiling, well past the default 60s -- live-caught running this spec: the
    // search-engine write for a freshly-created case_note can genuinely take well over a minute
    // to land in this environment, longer than the DDB-version-bump race
    // `04-cases.spec.ts`'s own case-detail test accounts for.
    test.setTimeout(240_000);
    await createCaseForExistingClient(page, SMOKE_ORG_A, SMOKE_CLIENT_A);

    // A single hyphen-free token, unique per run (timestamp) -- no semantic neighbors among past
    // runs' fixture text (see file header on why that matters for Keyword mode below), and a
    // plain lexical token a keyword tokenizer can't split into confusable pieces.
    const marker = `smokemarker${Date.now()}`;
    await page.waitForTimeout(3_000); // let create-time indexing settle before the next write, same as 04-cases.spec.ts
    const entryTypeSelect = page.getByRole('combobox', { name: 'Entry type' });
    await entryTypeSelect.click();
    await page.getByRole('option', { name: 'intake', exact: true }).click();
    await page.getByLabel('body').fill(`Smoke-suite search regression entry ${marker}.`);
    await page.getByRole('button', { name: 'Add entry', exact: true }).click();
    await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 });

    await page.goto('/search', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Search' })).toBeVisible();
    // The smoke user founds both fixture orgs, so this app's org picker renders here (search is
    // single-org-at-a-time, see SearchPage.tsx's own header comment) — pick the one the case
    // above actually lives in, same helper `03-clients.spec.ts`/`04-cases.spec.ts` already use.
    await pickOrgIfPresent(page, SMOKE_ORG_A);
    await page.getByRole('group', { name: 'Ranking mode' }).getByRole('button', { name: 'Keyword' }).click();

    expect(await searchUntilIndexed(page, marker)).toBe(true);
    await expect(page.getByText('Case entry').first()).toBeVisible();

    // Best-effort link check (see file header) -- only assert navigation IF a link rendered.
    // A bounded WAIT, not a `.count()` snapshot -- `fixtures/testData.ts`'s own file header
    // documents why: the link only appears once `SearchResultDisplay`'s own async caseId resolve
    // settles, and a `.count()` taken before that lands would misread "not yet resolved" as
    // "never resolves," silently skipping this assertion on a run where a link really would
    // appear moments later.
    const link = page.getByRole('link', { name: 'Case entry' });
    const linkAppeared = await link
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (linkAppeared) {
      await link.first().click();
      await page.waitForURL(/\/cases\/[^/]+$/, { timeout: 10_000 });
    }
  });

  test('ranking mode toggle and empty-query prompt', async ({ page }) => {
    await page.goto('/search', { waitUntil: 'networkidle' });
    await expect(page.getByText('Enter a search term to get started.')).toBeVisible();

    const modeGroup = page.getByRole('group', { name: 'Ranking mode' });
    await expect(modeGroup.getByRole('button', { name: 'Hybrid' })).toHaveAttribute('aria-pressed', 'true');
    await modeGroup.getByRole('button', { name: 'Keyword' }).click();
    await expect(modeGroup.getByRole('button', { name: 'Keyword' })).toHaveAttribute('aria-pressed', 'true');
  });
});

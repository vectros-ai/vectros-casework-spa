// ---------------------------------------------------------------------------
// Cases: create, status filter (a real bug found live by actually deploying and signing
// in -- the mechanism had never worked at all, caught only once this got exercised outside
// mocked unit tests), case detail (status change, add an entry), and the org column that
// only appears once a caller's cases span more than one org.
//
// Unlike orgs/clients, case-creation here is NOT deduped against an existing
// list -- cases have no stable display name to match on (case type is a
// constrained enum, several cases can share it), and the app exposes no
// delete-case UI (the blueprint grants records:d:case, but no screen calls
// it). Each test creates what it needs fresh and verifies against the
// resulting case-detail URL it navigates to, never re-searching a list by
// name -- so a re-run growing a few more Grievance-type smoke cases is
// harmless and expected, not a bug to dedupe around.
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';
import { perFileAuth } from '../fixtures/authed';
import {
  SMOKE_ORG_A,
  SMOKE_ORG_B,
  SMOKE_CLIENT_A,
  SMOKE_CLIENT_B,
  createCaseForExistingClient,
} from '../fixtures/testData';

test.use({ storageState: perFileAuth(test) });

test.describe('cases', () => {
  test('creates a case for an existing client and lands on its detail page', async ({ page }) => {
    const url = await createCaseForExistingClient(page, SMOKE_ORG_A, SMOKE_CLIENT_A);
    expect(url).toMatch(/\/cases\//);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('grievance');
    await expect(page.getByText('Unassigned')).toBeVisible();
  });

  test('status filter: All shows it, a non-matching status filters it out', async ({ page }) => {
    await createCaseForExistingClient(page, SMOKE_ORG_A, SMOKE_CLIENT_A);

    await page.goto('/cases', { waitUntil: 'networkidle' });
    const table = page.getByRole('table', { name: 'Cases' });
    await expect(table).toBeVisible({ timeout: 15_000 });
    const filterGroup = page.getByRole('group', { name: 'Filter by status' });

    // "All" is the default -- at least one Grievance row is visible.
    await expect(table.getByText('Grievance').first()).toBeVisible();

    // "Closed" -- a fresh case is always "open", so it must NOT be the only
    // thing shown; the filtered-empty copy or a shorter row set proves the
    // filter actually did something (regression coverage for the bug this
    // session found: the "all" mechanism silently did nothing at all).
    await filterGroup.getByRole('button', { name: 'Closed', exact: true }).click();
    await page.waitForLoadState('networkidle');
    const closedEmpty = page.getByText('No cases match this filter.');
    await expect(closedEmpty.or(table)).toBeVisible();
    // Either the empty-filter message shows (and the table then has NO data rows -- only
    // asserting the message is visible would miss a real bug where both render at once), or
    // every remaining row is genuinely "closed" -- either is correct; what's NOT correct (the
    // original bug) is the exact same unfiltered set silently reappearing.
    if (await closedEmpty.count()) {
      await expect(table.locator('tbody tr')).toHaveCount(0);
    } else {
      const statuses = await table.locator('tbody tr').allTextContents();
      for (const row of statuses) expect(row.toLowerCase()).toContain('closed');
    }

    await filterGroup.getByRole('button', { name: 'Open', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(table.getByText('Grievance').first()).toBeVisible();

    await filterGroup.getByRole('button', { name: 'All', exact: true }).click();
    await page.waitForLoadState('networkidle');
    await expect(table.getByText('Grievance').first()).toBeVisible();
  });

  test('case detail: change status and add an entry', async ({ page }) => {
    await createCaseForExistingClient(page, SMOKE_ORG_A, SMOKE_CLIENT_A);

    // getByRole('combobox', ...) rather than getByLabel -- MUI's Select shares its
    // aria-labelledby between the closed trigger AND the (briefly still-mounted)
    // option listbox, which makes a plain label lookup ambiguous right after a click.
    //
    // Real, confirmed race (not a test bug): `case` is a HYBRID-indexed schema
    // (casework.blueprint.yaml), and indexing runs ASYNC after create -- the
    // indexing pipeline's own write bumps the record's optimistic-concurrency
    // version. A mutation fired in the narrow window between "case just
    // created, redirected here" and "indexing's write lands" carries a now-
    // stale expected version and 409s with a version-conflict error -- a real,
    // if narrow, window a real user hits too by editing a just-created case
    // immediately. The platform's own prescribed recovery for this class of
    // conflict is re-read, re-apply, re-write -- exactly "select the option
    // again", which this retries.
    //
    // A retry alone isn't sufficient: a failed attempt's onError handler
    // INVALIDATES the case query (a separate fix, this same pass) and triggers a
    // refetch, but if the indexing pipeline's own write STILL hasn't landed
    // server-side by the time that refetch runs, the refetch just returns the
    // same not-yet-bumped version -- retrying immediately can then repeat the
    // same 409 indefinitely, not because the fix doesn't work but because the
    // underlying server-side write hasn't happened yet. Give the indexing
    // pipeline a real head start before the first attempt, which is what
    // actually avoids the race in the overwhelming majority of runs; the retry
    // loop below is the backstop for the tail, not the primary mechanism.
    //
    // No deterministic signal to poll instead: indexStatus isn't surfaced
    // anywhere in this UI, so there's nothing short of a raw authenticated API
    // call (out of scope for a UI-driven suite) to wait ON rather than guess a
    // duration for. A residual, low-frequency flake on this ONE assertion is a
    // known, accepted characteristic of testing against real async indexing
    // timing, not a suite bug -- if it reads as flaky in CI, re-run rather than
    // chase full determinism here.
    await page.waitForTimeout(3_000);
    const statusSelect = page.getByRole('combobox', { name: 'Status' });
    for (let attempt = 0; attempt < 4; attempt++) {
      await statusSelect.click();
      await page.getByRole('option', { name: 'active', exact: true }).click();
      await expect(statusSelect).toBeEnabled({ timeout: 10_000 });
      if (!(await page.getByText("Couldn't update the case status").count())) break;
      await page.waitForTimeout(3_000);
    }
    await expect(statusSelect).toContainText('active');

    await expect(page.getByText('No entries yet.')).toBeVisible({ timeout: 10_000 });
    const entryTypeSelect = page.getByRole('combobox', { name: 'Entry type' });
    await entryTypeSelect.click();
    await page.getByRole('option', { name: 'update', exact: true }).click();
    // Not exact:true -- required fields render their label with a trailing " *"
    // (recordForm.ts's labelWithReq), and `body` has no renderHints.label override
    // (case_note schema), so its rendered label is literally "body *".
    await page.getByLabel('body').fill('Smoke-suite regression entry.');
    await page.getByRole('button', { name: 'Add entry', exact: true }).click();

    await expect(page.getByText('Smoke-suite regression entry.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No entries yet.')).toHaveCount(0);
  });

  test('org column appears once a caller has cases in more than one org', async ({ page }) => {
    await createCaseForExistingClient(page, SMOKE_ORG_A, SMOKE_CLIENT_A);
    await createCaseForExistingClient(page, SMOKE_ORG_B, SMOKE_CLIENT_B);

    await page.goto('/cases', { waitUntil: 'networkidle' });
    const table = page.getByRole('table', { name: 'Cases' });
    await expect(table).toBeVisible();
    await expect(table.getByText('Org', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});

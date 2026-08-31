// ---------------------------------------------------------------------------
// Clients: create (idempotent, org-scoped), edit/save, and archive/reactivate.
// Depends on 02-orgs.spec.ts's fixture orgs (Smoke Org A/B) already existing --
// specs run in numeric filename order (playwright.config.ts: fullyParallel
// false, workers 1), so 02 always runs first within a suite invocation.
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';
import { perFileAuth } from '../fixtures/authed';
import { SMOKE_ORG_A, SMOKE_CLIENT_A, ensureClientExists, existsWithin, pickOrgIfPresent } from '../fixtures/testData';

test.use({ storageState: perFileAuth(test) });

test.describe('clients', () => {
  test('creates the fixture client (idempotent) and lists it', async ({ page }) => {
    await ensureClientExists(page, SMOKE_ORG_A, SMOKE_CLIENT_A);
    await page.goto('/clients', { waitUntil: 'networkidle' });
    await pickOrgIfPresent(page, SMOKE_ORG_A);
    await expect(page.getByRole('link', { name: SMOKE_CLIENT_A, exact: true })).toBeVisible();
  });

  test('client detail: edit fields, archive, then reactivate', async ({ page }) => {
    await ensureClientExists(page, SMOKE_ORG_A, SMOKE_CLIENT_A);
    await page.goto('/clients', { waitUntil: 'networkidle' });
    await pickOrgIfPresent(page, SMOKE_ORG_A);
    await page.getByRole('link', { name: SMOKE_CLIENT_A, exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: SMOKE_CLIENT_A })).toBeVisible();
    await page.getByLabel('Department').fill('Operations');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 10_000 });

    // Archive, then reactivate -- exercises both directions of the same toggle so a
    // re-run of this spec doesn't leave the fixture client stuck SUSPENDED.
    //
    // A bounded wait, not a `.count()` snapshot (see fixtures/testData.ts's file header) -- the
    // button only renders once ClientDetailPage's own `clientQuery` resolves, which is async and
    // not guaranteed to have settled by the time the heading assertion above passes (that heading
    // and this button are siblings in the same conditional render block, but nothing here proves
    // they commit in the same tick).
    const archiveBtn = page.getByRole('button', { name: 'Archive client' });
    if (await existsWithin(page, archiveBtn)) {
      // Opens a confirmation dialog rather than archiving directly -- confirm it before
      // expecting the success state. Reactivate has no such confirmation (it's the
      // un-doing of an archive, not a destructive step), so it stays a direct click.
      await archiveBtn.click();
      await page.getByRole('button', { name: 'Yes, archive' }).click();
      // `exact: true` -- the un-exact "Archived" also matches the page's own status badge
      // (`clientDetail.archivedBadge`, rendered right alongside this success alert), which
      // is a DIFFERENT element than the success confirmation this assertion means to check.
      await expect(page.getByText('Archived.', { exact: true })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Reactivate client' }).click();
      // The badge itself, not the (now-dismissed-by-reset) success alert -- confirms the
      // status genuinely reverted, which `toHaveCount(0)` on the un-exact text couldn't tell
      // apart from the badge simply not having re-rendered yet.
      await expect(page.getByText('Archived', { exact: true })).toHaveCount(0, { timeout: 10_000 });
    }
  });
});

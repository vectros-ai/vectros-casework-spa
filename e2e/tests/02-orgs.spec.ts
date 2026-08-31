// ---------------------------------------------------------------------------
// Orgs: create (idempotent -- reuses an existing fixture org by name rather
// than growing a new one every run), edit, and the delete/danger-zone path
// on a dedicated throwaway org so the fixture orgs other specs depend on are
// never at risk of being deleted by this spec itself.
//
// Two persistent fixture orgs are created here (SMOKE_ORG_A / SMOKE_ORG_B),
// not one -- 04-cases.spec.ts needs cases split across two different orgs to
// exercise CasesListPage's org column, which only renders once a caller's
// cases span more than one org.
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';
import { perFileAuth } from '../fixtures/authed';
import { SMOKE_ORG_A, SMOKE_ORG_B, ensureOrgExists } from '../fixtures/testData';

test.use({ storageState: perFileAuth(test) });

test.describe('orgs', () => {
  test('creates the two fixture orgs (idempotent) and lists them', async ({ page }) => {
    await ensureOrgExists(page, SMOKE_ORG_A);
    await ensureOrgExists(page, SMOKE_ORG_B);

    await page.goto('/orgs', { waitUntil: 'networkidle' });
    await expect(page.getByRole('link', { name: SMOKE_ORG_A, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: SMOKE_ORG_B, exact: true })).toBeVisible();
    // "Your role" column -- this page only ever lists founded orgs.
    await expect(page.getByText('Founder').first()).toBeVisible();
  });

  test('org detail: edit and save profile fields', async ({ page }) => {
    await ensureOrgExists(page, SMOKE_ORG_A);
    await page.goto('/orgs', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: SMOKE_ORG_A, exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: SMOKE_ORG_A })).toBeVisible();
    const hq = page.getByLabel('Headquarters (city, state/country)');
    await hq.fill('Springfield, IL');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible({ timeout: 10_000 });
  });

  test('delete flow works on a dedicated throwaway org', async ({ page }) => {
    const throwawayName = `Smoke Throwaway ${Date.now()}`;
    await ensureOrgExists(page, throwawayName);

    await page.goto('/orgs', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: throwawayName, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: throwawayName })).toBeVisible();

    await page.getByRole('button', { name: 'Delete org' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Delete this org?' })).toBeVisible();

    const confirmField = dialog.getByLabel(`Type "${throwawayName}" to confirm`);
    // Scoped to the dialog -- the trigger button behind it is also named "Delete org".
    const deleteConfirmBtn = dialog.getByRole('button', { name: 'Delete org', exact: true });
    await expect(deleteConfirmBtn).toBeDisabled();
    await confirmField.fill(throwawayName);
    await expect(deleteConfirmBtn).toBeEnabled();
    await deleteConfirmBtn.click();

    await expect(page.getByRole('heading', { level: 1, name: 'Orgs' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: throwawayName, exact: true })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Shared fixture-data helpers: idempotent "ensure X exists" creators used by
// several spec files. Lives here rather than in a .spec.ts file -- Playwright
// re-executes a spec file's top-level code (including its test.describe/test
// registrations) whenever another spec file imports it, which would silently
// duplicate tests across files. A plain fixtures/ module has no such risk.
//
// Existence checks below use `locator.waitFor(...)` (a real, bounded WAIT),
// never a bare `locator.count()` snapshot -- count() reads the DOM at the
// instant it's called with no retry, which races every org-scoped list
// query on this app (react-query's fetch doesn't start/settle synchronously
// with a click). A snapshot count() genuinely produced duplicate "Smoke
// Client A" entities live against staging before this was caught (2026-08-28)
// -- this app has no client-delete capability, so that mistake is permanent;
// don't reintroduce the pattern.
// ---------------------------------------------------------------------------

import { type Page, expect } from '@playwright/test';

export const SMOKE_ORG_A = 'Smoke Org A';
export const SMOKE_ORG_B = 'Smoke Org B';
export const SMOKE_CLIENT_A = 'Smoke Client A';
export const SMOKE_CLIENT_B = 'Smoke Client B';

/** True if `locator` has at least one match within `timeoutMs` -- a bounded wait,
 *  not an instant snapshot (see file header). Exported: every spec file's own conditional-UI
 *  check (an org picker or an action button that only renders once some async query settles)
 *  needs the same bounded wait, not a bare `.count()` snapshot -- see each call site's own
 *  comment for why a snapshot would race there too. */
export async function existsWithin(page: Page, locator: ReturnType<Page['getByRole']>, timeoutMs = 8_000): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Creates the named org via the UI if it isn't already in the list; no-ops otherwise. */
export async function ensureOrgExists(page: Page, name: string): Promise<void> {
  await page.goto('/orgs', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Orgs' })).toBeVisible();

  if (await existsWithin(page, page.getByRole('link', { name, exact: true }))) return;

  await page.getByRole('button', { name: '+ Create org' }).click();
  await expect(page.getByRole('heading', { name: 'Create org' })).toBeVisible();
  await page.getByLabel('Org name').fill(name);
  await page.getByRole('button', { name: 'Create org', exact: true }).click();
  // Success navigates straight to the new org's OWN detail page (OrgsListPage.tsx's own
  // `handleCreated`) -- it does NOT return to the /orgs list, so waiting for `name` to appear as
  // a LIST LINK here (what this used to do) can never pass for a freshly-created org; the
  // previous version of this helper only ever "worked" for an org that already existed (the
  // early-return above), never for a genuine first-time create, which is exactly why only the
  // one caller creating a genuinely-new throwaway org per run ever exercised this path and failed.
  // Confirms creation succeeded; doesn't navigate back to /orgs itself -- every caller already
  // does its own follow-up `page.goto` (to `/orgs` or `/clients`) right after this returns.
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible({ timeout: 15_000 });
}

/** Selects orgName in a page's org picker, if one is rendered (only shown when the
 *  caller has more than one org -- several pages hide it entirely for a single-org caller).
 *  Waits for the picker's own "an org is now selected" signal (the empty-state prompt
 *  disappearing), not just a fixed pause -- see file header on why a snapshot isn't enough. */
export async function pickOrgIfPresent(page: Page, orgName: string): Promise<void> {
  const orgPicker = page.getByLabel('Org', { exact: true });
  // A bounded wait, not a `.count()` snapshot (see file header) -- the picker's own presence
  // depends on `useAccessibleOrgs` resolving `orgs.length > 1` asynchronously, so a snapshot
  // taken before that resolves would wrongly conclude "single-org caller, nothing to pick" and
  // silently proceed against whichever org is already showing.
  if (await existsWithin(page, orgPicker, 8_000)) {
    await orgPicker.click();
    await page.getByRole('option', { name: orgName, exact: true }).click();
    // Whichever "org not yet picked" prompt this page shows must be gone before the org-scoped
    // query below can be trusted -- exact wording differs per page (clients.pickOrgPrompt vs.
    // cases' own), so match on the stable substring instead of hardcoding one page's copy. Not
    // `.catch`-swallowed: `toHaveCount(0)` passes immediately if the prompt was never rendered in
    // the first place, so there's no legitimate case where this SHOULD time out -- a timeout here
    // means the org switch is genuinely stuck, and that should fail loudly at the point of the
    // actual problem, not several assertions later against stale/loading DOM.
    await expect(page.getByText(/pick an org/i)).toHaveCount(0, { timeout: 10_000 });
    // Any "Loading …" indicator for the newly-selected org's own data must also clear.
    await expect(page.getByText(/^Loading /)).toHaveCount(0, { timeout: 10_000 });
  }
}

/** Creates the named client under orgName via the UI if it isn't already listed. */
export async function ensureClientExists(page: Page, orgName: string, name: string): Promise<void> {
  await ensureOrgExists(page, orgName);
  await page.goto('/clients', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  await pickOrgIfPresent(page, orgName);

  if (await existsWithin(page, page.getByRole('link', { name, exact: true }))) return;

  await page.getByRole('button', { name: '+ Create client' }).click();
  await expect(page.getByRole('heading', { name: 'Create client' })).toBeVisible();
  await page.getByLabel('Client name').fill(name);
  await page.getByRole('button', { name: 'Create client', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible({ timeout: 15_000 });
}

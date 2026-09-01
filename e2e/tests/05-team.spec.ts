// ---------------------------------------------------------------------------
// Team / invite: the core admin flow. Scoped down per the build plan -- a
// full accept-invite round trip needs a second throwaway identity, which is
// heavier than this first pass covers; this confirms the invite call
// succeeds and the roster reflects it, not the full two-party handshake.
// (01-login.spec.ts / fixtures/authed.ts already exercise a real
// accept-invite + first-login round trip for the smoke user itself, so the
// mechanism is covered elsewhere -- just not a SECOND identity's full loop.)
//
// A fresh email per run, not one fixed address -- re-inviting an already-PENDING
// email only resends for a caller holding `users:r`+`users:u`, which `hr-admin`
// deliberately does NOT hold (casework.blueprint.yaml's own comment: "No
// profiles:u deliberately -- re-inviting an already-pending email would
// otherwise silently rotate/resend the invite token, which this delivery
// explicitly cuts"). Confirmed live: a second invite to the same still-pending
// email 409s ("User with email '...' already exists in this tenant"), not a
// resend. A fresh email each run accepts a growing roster of pending smoke
// invites as harmless clutter, same tradeoff this suite already makes for
// cases (no delete-case UI either) -- and is arguably more representative of
// real usage than reusing one throwaway address forever.
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';
import { perFileAuth } from '../fixtures/authed';
import { SMOKE_ORG_A, ensureOrgExists, existsWithin } from '../fixtures/testData';

test.use({ storageState: perFileAuth(test) });

test.describe('team', () => {
  test('lists the signed-in smoke user as an active HR admin', async ({ page }) => {
    await page.goto('/team', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
    const table = page.getByRole('table', { name: 'Team' });
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table.getByText('HR admin').first()).toBeVisible();
    await expect(table.getByText('Active').first()).toBeVisible();
  });

  test('invites a case handler and the roster reflects it', async ({ page }) => {
    // example.com (RFC 2606) -- reserved for documentation/testing, never a
    // real deliverable mailbox. This suite ships publicly: a forker's own
    // deployment mints a REAL invite send, so a hardcoded @vectros.ai
    // address would target the VENDOR's own domain from every fork that
    // runs this spec, not a safe throwaway.
    const inviteEmail = `smoke-team-invite-${Date.now()}@example.com`;
    await ensureOrgExists(page, SMOKE_ORG_A);
    await page.goto('/team', { waitUntil: 'networkidle' });

    // The roster row never shows an email at all for `hr-admin` -- only the raw
    // `usr_<id>` principalId (TeamPage.tsx's own comment: `hr-admin` doesn't hold
    // `users:r`, so email resolution never succeeds for anyone). Capture the real
    // invited userId from the invite response itself so the roster check has
    // something to actually match against.
    const inviteResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/v1/users/invite') && res.request().method() === 'POST',
    );

    await page.getByRole('button', { name: 'Invite' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Invite someone' })).toBeVisible();
    // The dialog's own fields are gated behind an async "your orgs" fetch
    // (orgsQuery.isSuccess) -- wait for its loading state to clear first.
    await expect(dialog.getByText('Loading your orgs…')).toHaveCount(0, { timeout: 10_000 });

    // getByRole('textbox', ...) rather than getByLabel -- MUI's outlined TextField
    // duplicates its label text into the fieldset legend for the notch cutout, which
    // getByLabel's <label>-association lookup doesn't resolve the same way role-based
    // accessible-name matching does.
    await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill(inviteEmail);
    // Role defaults to "Case handler" (INVITE_ROLES[0]) -- no need to touch the Role select.

    // A bounded wait, not a `.count()` snapshot (see fixtures/testData.ts's file header) -- the
    // picker only renders once InviteDialog's own org-discovery query resolves AND finds more than
    // one org, both async.
    const orgSelect = dialog.getByRole('combobox', { name: 'Org' });
    if (await existsWithin(page, orgSelect)) {
      await orgSelect.click();
      await page.getByRole('option', { name: SMOKE_ORG_A, exact: true }).click();
    }

    await dialog.getByRole('button', { name: 'Send invite', exact: true }).click();
    const inviteResponse = await inviteResponsePromise;
    const inviteBody = await inviteResponse.json();
    const invitedUserId: string = inviteBody.userId;
    expect(typeof invitedUserId).toBe('string');
    expect(invitedUserId.length).toBeGreaterThan(0);

    // Formerly tolerated EITHER outcome here: the org-membership grant half of
    // every invite used to fail a platform-side ownership check --
    // inviteMember.ts stamps the INVITEE's userId onto the membership record it
    // creates, which the platform rejected for anyone but the record's own
    // author. Fixed with a platform capability the blueprint's hr-admin role now
    // grants explicitly (see casework.blueprint.yaml's own comment on that
    // clause) -- now requiring the full-success outcome only, so this spec
    // actually gates a regression instead of passing on either.
    await expect(page.getByText('Invite sent.')).toBeVisible({ timeout: 15_000 });

    const table = page.getByRole('table', { name: 'Team' });
    const invitedRow = table.getByRole('row').filter({ hasText: invitedUserId });
    await expect(invitedRow).toBeVisible({ timeout: 15_000 });
    await expect(invitedRow.getByText('Case handler')).toBeVisible();
  });
});

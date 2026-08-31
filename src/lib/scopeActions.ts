// ---------------------------------------------------------------------------
// scopeActions — the scope-action strings this app gates nav items, routes,
// AND landing-page content on. A single source of truth so a nav item's
// `gateAction`, its route's `RequireScope`, and HomePage's own role-aware
// content can never drift into three different spellings of "can this caller
// reach Cases/Orgs/Team" — they were all hand-copied constants living in
// App.tsx alone before this file existed.
// ---------------------------------------------------------------------------

/** The scope-action a caller needs to reach Org management. */
export const ORGS_ACTION = 'entities:c:org';
/** Same pattern for Cases. Read, not create — both case-handler and HR admin
 *  hold `records:r:case` (a case-handler's own via the `cru` clause, an HR
 *  admin's explicitly), so this is the right floor for "can reach the list
 *  at all," even though the list itself has no create control yet (see
 *  CasesListPage's own note on why). */
export const CASES_ACTION = 'records:r:case';
/** The scope-action for Team — `profiles:r`. Only `hr-admin` holds any
 *  `profiles:*` grant at all (the `member-lifecycle` clause), so this floor
 *  correctly hides the nav item and the route for `case-handler`. */
export const TEAM_ACTION = 'profiles:r';
/** The scope-action for Clients — `entities:c:client`. Both roles hold this
 *  org-wide (item C's data-isolation pass narrows READ, not create — see
 *  `casework.blueprint.yaml`'s own comment on that split), so this floor
 *  correctly shows the nav item for either role; what each caller actually
 *  SEES once inside is a separate, narrower question `useAccessibleClients`
 *  answers per-role. */
export const CLIENTS_ACTION = 'entities:c:client';

// ---------------------------------------------------------------------------
// caseStatusColors — the case-status → chip-color mapping. Was independently
// declared, byte-identical, in both CasesListPage.tsx and CaseDetailPage.tsx —
// a future status change or recolor had to be made in two places with
// nothing enforcing they stay in sync. One source of truth now.
// ---------------------------------------------------------------------------

export const STATUS_COLORS: Record<string, 'default' | 'info' | 'warning' | 'success'> = {
  open: 'info',
  active: 'warning',
  closed: 'success',
};

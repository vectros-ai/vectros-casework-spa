// ---------------------------------------------------------------------------
// OrgPickerField — "pick the org this action applies to," the exact same
// three-way shape independently re-authored in CreateCaseDialog
// (CasesListPage.tsx), ClientsListPage's page-level org picker, and TeamPage's
// InviteDialog — the comments at two of those three call sites even
// cross-referenced each other, confirming the authors knew it was the same
// logic and re-wrote it inline anyway. One shared component now:
//
//   - More than one org: an editable select.
//   - Exactly one org: a disabled field NAMING it — never silently implied.
//     Auto-selecting an org with nothing shown reads as broken, not as "no
//     decision needed"; a disabled field communicates the latter.
//   - Zero orgs: renders nothing — the caller's own "you have no orgs" empty
//     state handles that case, same as before this component existed.
//
// This also closes a real drift: ClientsListPage's own picker previously
// showed NEITHER a picker NOR the disabled fallback for a single-org caller
// (just silently omitted the field) — the two other call sites already had
// the fallback. All three now behave identically.
// ---------------------------------------------------------------------------

import { MenuItem, TextField } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';
import { useIntl } from 'react-intl';

import type { EntityResponse } from '../api/vectrosApi';

export interface OrgPickerFieldProps {
  readonly orgs: ReadonlyArray<EntityResponse>;
  /** The selected org id — ignored (and the field disabled) when there's only one org. */
  readonly value: string;
  readonly onChange: (orgId: string) => void;
  /** Message id for the field's label (each call site's own copy — "Org" today everywhere,
   *  but kept per-caller so a future divergence doesn't need this component to change). */
  readonly labelId: string;
  readonly disabled?: boolean;
  readonly required?: boolean;
  readonly sx?: SxProps<Theme>;
}

export function OrgPickerField({
  orgs,
  value,
  onChange,
  labelId,
  disabled = false,
  required = false,
  sx,
}: OrgPickerFieldProps): React.JSX.Element | null {
  const intl = useIntl();
  const label = intl.formatMessage({ id: labelId });

  if (orgs.length > 1) {
    return (
      <TextField
        select
        label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        size="small"
        fullWidth
        disabled={disabled}
        required={required}
        {...(sx ? { sx } : {})}
      >
        {orgs.map((org) => (
          <MenuItem key={org.id} value={org.id ?? ''}>
            {org.name && org.name.length > 0 ? org.name : org.externalId}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  if (orgs.length === 1) {
    return (
      <TextField
        label={label}
        value={orgs[0]?.name && orgs[0].name.length > 0 ? orgs[0].name : (orgs[0]?.externalId ?? '')}
        size="small"
        fullWidth
        disabled
        {...(sx ? { sx } : {})}
      />
    );
  }

  return null;
}

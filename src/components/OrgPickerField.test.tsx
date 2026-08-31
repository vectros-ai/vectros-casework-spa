// ---------------------------------------------------------------------------
// OrgPickerField tests — the shared 3-way org-picker.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrgPickerField } from './OrgPickerField';
import { IntlProvider } from '../i18n/IntlProvider';

const ORG_A = { id: 'org_1', name: 'Acme Inc' };
const ORG_B = { id: 'org_2', name: 'Beta LLC' };

function renderField(props: Partial<React.ComponentProps<typeof OrgPickerField>> = {}) {
  render(
    <IntlProvider>
      <OrgPickerField orgs={[]} value="" onChange={vi.fn()} labelId="clients.fieldOrg" {...props} />
    </IntlProvider>,
  );
}

describe('OrgPickerField', () => {
  it('renders nothing for zero orgs', () => {
    renderField({ orgs: [] });
    expect(screen.queryByLabelText('Org')).not.toBeInTheDocument();
  });

  it('renders a disabled field naming the org for exactly one org', () => {
    renderField({ orgs: [ORG_A], value: 'org_1' });
    const field = screen.getByLabelText('Org');
    expect(field).toBeDisabled();
    expect(field).toHaveValue('Acme Inc');
  });

  it('renders an editable select for more than one org, and reports the change', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderField({ orgs: [ORG_A, ORG_B], value: 'org_1', onChange });

    const field = screen.getByLabelText('Org');
    expect(field).toBeEnabled();
    await user.click(field);
    await user.click(await screen.findByRole('option', { name: 'Beta LLC' }));

    expect(onChange).toHaveBeenCalledWith('org_2');
  });

  it('falls back to externalId when an org has no name', () => {
    renderField({ orgs: [{ id: 'org_3', externalId: 'org_ext_3' }], value: 'org_3' });
    expect(screen.getByLabelText('Org')).toHaveValue('org_ext_3');
  });
});

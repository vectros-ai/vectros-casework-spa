// ---------------------------------------------------------------------------
// SuccessAlert tests — the shared success-confirmation banner.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuccessAlert } from './SuccessAlert';

describe('SuccessAlert', () => {
  it('renders its children inside a status alert', () => {
    render(<SuccessAlert onDismiss={vi.fn()}>Saved.</SuccessAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('calls onDismiss when closed', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SuccessAlert onDismiss={onDismiss}>Saved.</SuccessAlert>);

    await user.click(screen.getByRole('button', { name: /close/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

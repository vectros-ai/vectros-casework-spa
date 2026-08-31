// ---------------------------------------------------------------------------
// EmptyStateCard tests — the shared "nothing here yet" card.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyStateCard } from './EmptyStateCard';
import { IntlProvider } from '../i18n/IntlProvider';

describe('EmptyStateCard', () => {
  it('renders the message for the given id', () => {
    render(
      <IntlProvider>
        <EmptyStateCard messageId="orgs.empty" />
      </IntlProvider>,
    );
    expect(screen.getByText('No orgs yet — create one to get started.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// IntlProvider — casework-spa's i18n entry point.
//
// The locale-detection + react-intl wrapper lives in @vectros-ai/react
// (catalog-agnostic). This thin wrapper supplies THIS app's English catalog
// merged over the shared package's own component strings (AppLayout chrome,
// etc.) — the package catalog is the base, this app's keys win on collision.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { IntlProvider as VectrosIntlProvider, baseMessagesEn } from '@vectros-ai/react';
import type { MessagesByLocale } from '@vectros-ai/react';

import messagesEn from './messages.en.json';

export { I18N_DEFAULT_LOCALE } from '@vectros-ai/react';

const MESSAGES_BY_LOCALE: MessagesByLocale = {
  en: { ...baseMessagesEn, ...messagesEn },
};

interface IntlProviderProps {
  readonly children: ReactNode;
  /** Optional locale override — primarily for tests. */
  readonly locale?: string;
}

export function IntlProvider({ children, locale }: IntlProviderProps): React.JSX.Element {
  return (
    <VectrosIntlProvider messagesByLocale={MESSAGES_BY_LOCALE} locale={locale}>
      {children}
    </VectrosIntlProvider>
  );
}

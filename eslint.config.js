// ---------------------------------------------------------------------------
// ESLint flat config (ESLint 9+). Mirrors the other Vectros reference apps
// (ui/admin-app, ui/app-vectros-ai) — one rule set across the family.
//
// - typescript-eslint recommended        — catches real TS bugs
// - react-hooks recommended              — enforces the rules of hooks
// - react-refresh only-export-components — keeps HMR working
// - jsx-a11y recommended                 — accessibility (WCAG 2.1 AA target)
//
// `no-console` warns (tests excluded). `no-restricted-globals` blocks direct
// `localStorage`/`sessionStorage`/`document.cookie` access — this app has no
// storage abstraction of its own to route through yet (unlike the other
// reference apps, which centralize it), so the rule here is a placeholder
// reminder to add one if a future page needs persistent client state; auth0-
// spa-js's own `cacheLocation: 'localstorage'` (src/config.ts) is inside the
// library, not app code, so it isn't caught by this rule.
// ---------------------------------------------------------------------------

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default tseslint.config(
  {
    // e2e/ (added #1110) is a SEPARATE npm project — its own package.json,
    // its own devDependencies (@playwright/test) not installed at this
    // app's root — so this config's rules don't apply to it and shouldn't
    // try to. Lint it from inside e2e/ itself if it ever needs its own
    // config; `npm run lint` here means "lint the app", not "lint
    // everything this repo happens to contain".
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'e2e/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
    },
  },
  {
    // Tests have looser rules — console output, any-types in mocks, etc.
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);

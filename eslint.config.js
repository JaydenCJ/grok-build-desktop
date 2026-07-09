import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/', 'coverage/', 'src-tauri/target/', 'src-tauri/gen/', 'node_modules/'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactRefresh.configs.vite],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // The classic vite-template pair. The plugin's v7 flat.recommended also
      // ships React-Compiler preview rules (refs/set-state-in-effect/…) that
      // reject long-standing intentional patterns here (render-scope ref
      // mirrors, sync state seeding); adopt those with the compiler, not now.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The codebase already uses the `_`-prefix convention for deliberate
      // discards (e.g. rest-destructuring a field away in tests).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // The i18n entry point deliberately co-locates the provider with its hook
    // and helpers — splitting it would only serve Fast Refresh, which falls
    // back to a full reload for this rarely-edited file.
    files: ['src/i18n/index.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Node-side scripts: the structural smoke test and the headless e2e runner.
    files: ['scripts/**/*.mjs', 'e2e/**/*.mjs', '*.config.ts', 'vite.config.ts'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
  },
  {
    // The Tauri IPC mock runs inside the browser page, before app scripts.
    files: ['e2e/tauri-mock.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
  },
);

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'target/**',
      'src-tauri/**',
      'node_modules/**',
      '.bhippi/**',
      '.venv/**',
      'public/characters/**',
      'src/lib/fiwn/vendor/**',
      // Vendored, SHA-256 pinned third-party bundles: not ours to lint.
      'public/plugin-libs/**',
      // Prototypes and scratch tools, not part of the shipped app build.
      'docs/character-studio/**',
      'tools/ideagraph-live/**',
      '*-lab.html',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // A leading underscore marks a deliberately unused parameter or binding
      // (kept for signature parity with the API it implements).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Tests build partial stand-ins for API responses, so `any` is the honest
    // annotation there instead of a type the test would only pretend to satisfy.
    files: ['tests/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'target/**', 'src-tauri/**', 'node_modules/**', '.bhippi/**', '.venv/**', 'public/characters/**', 'src/lib/fiwn/vendor/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx,js,mjs}'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
);

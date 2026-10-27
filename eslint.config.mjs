// Strict React hooks lint for the registry blocks: eslint-plugin-react-hooks' `recommended` config, which includes the React
// Compiler rules (purity, refs, immutability, set-state-in-effect, ...). Blocks are copied into apps that may run the compiler or
// this same config, so a violation here is a bug in every app. `npm run check` runs it with --max-warnings 0 (scripts/check-block-hooks.mjs).
import reactHooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  {
    files: ['registry/**/*.{ts,tsx}'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    ...reactHooks.configs.flat.recommended,
  },
];

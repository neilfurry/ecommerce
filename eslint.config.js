// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/generated/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  // k6 load-test scripts (k6's own JavaScript runtime and globals)
  {
    files: ['load/k6/**/*.js'],
    languageOptions: {
      globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', open: 'readonly' },
    },
  },
  // Node: API, worker, scripts, configs
  {
    files: [
      'apps/api/**/*.ts',
      'apps/worker/**/*.ts',
      '*.{js,cjs,mjs,ts,mts}',
      'apps/*/*.js',
      'apps/*/test/*.js',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.cjs', 'apps/api/*.js', 'apps/worker/*.js', 'apps/*/test/*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // Nest DI reads constructor parameter types at runtime, so value imports must stay.
    files: [
      'apps/api/src/**/*.ts',
      'apps/worker/src/**/*.ts',
      'apps/api/test/**/*.ts',
      'apps/worker/test/**/*.ts',
    ],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: [
      '**/prisma/seed.ts',
      '**/prisma/import-locations.ts',
      '**/main.ts',
      'apps/api/src/scripts/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  // Browser: frontends and shared UI
  {
    files: [
      'apps/{storefront,seller-portal,admin-portal}/src/**/*.{ts,tsx}',
      'packages/{ui,api-client}/src/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Fast-refresh boundaries only matter inside the apps; shared packages export helpers too.
    files: ['apps/{storefront,seller-portal,admin-portal}/src/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        { allowExportNames: ['routes', 'NAV_SECTIONS'] },
      ],
    },
  },
  {
    files: [
      '**/*.{test,spec}.{ts,tsx}',
      '**/*.e2e-spec.ts',
      '**/*.integration-spec.ts',
      'e2e/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.node, ...globals.jest, ...globals.vitest } },
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
  prettier,
);

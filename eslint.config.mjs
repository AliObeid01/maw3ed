import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import i18next from 'eslint-plugin-i18next';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'design/**', 'next-env.d.ts']),
  {
    // NFR-12: no hardcoded UI strings in components or pages
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    plugins: { i18next },
    rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }] },
  },
  {
    // Layering: only repositories may touch Prisma
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/repositories/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@prisma/client', '**/repositories/db'], message: 'Only src/server/repositories may import Prisma.' },
          ],
        },
      ],
    },
  },
]);

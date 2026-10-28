import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import i18next from 'eslint-plugin-i18next';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'design/**', 'next-env.d.ts']),
  {
    // NFR-12: no hardcoded UI strings in components or pages (text and user-facing attributes)
    files: ['src/app/**/*.tsx', 'src/components/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': [
        'error',
        {
          mode: 'jsx-only',
          'jsx-attributes': {
            include: ['aria-label', 'aria-description', 'placeholder', 'title', 'alt', 'label'],
          },
        },
      ],
    },
  },
  {
    // Layering: only repositories may touch Prisma. Revisit the generated-client globs when the schema lands.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/server/repositories/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@prisma/client', '**/generated/prisma*', '**/repositories/db'],
              message: 'Only src/server/repositories may import Prisma.',
            },
          ],
        },
      ],
    },
  },
  {
    // Domain code is pure: inject `now`, never read the clock.
    files: ['src/server/domain/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Domain code must not call Date.now(); inject `now`.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Domain code must not call new Date(); inject `now`.',
        },
        {
          selector: "CallExpression[callee.object.name='DateTime'][callee.property.name='now']",
          message: 'Domain code must not call DateTime.now(); inject `now`.',
        },
      ],
    },
  },
]);

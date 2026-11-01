import { test as base } from '@playwright/test';
import { findIntlProblems } from './intlErrorPatterns';

/**
 * The `test` every spec uses. In a production build (what e2e serves) a missing message does not throw: it
 * logs a next-intl error and renders the raw key. This fixture records console errors and page errors and fails
 * the test at teardown when one is a next-intl problem, so a scope hole (src/i18n/scopes.ts) cannot ship.
 * A spec that expects such errors opts out with `test.use({ allowIntlErrors: true })`.
 */
export const test = base.extend<{ allowIntlErrors: boolean; intlGuard: void }>({
  allowIntlErrors: [false, { option: true }],
  intlGuard: [
    async ({ page, allowIntlErrors }, use) => {
      const entries: { type: string; text: string }[] = [];
      page.on('console', (m) => entries.push({ type: m.type(), text: m.text() }));
      page.on('pageerror', (e) => entries.push({ type: 'pageerror', text: e.message }));
      await use();
      if (!allowIntlErrors) {
        const problems = findIntlProblems(entries);
        if (problems.length) throw new Error(`next-intl problems in the browser:\n${problems.join('\n')}`);
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

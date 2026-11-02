import { test as base } from '@playwright/test';
import { findCspProblems, findIntlProblems } from './intlErrorPatterns';

/**
 * The `test` every spec uses. In a production build (what e2e serves) a missing message does not throw: it
 * logs a next-intl error and renders the raw key. This fixture records console errors and page errors and fails
 * the test at teardown when one is a next-intl problem, so a scope hole (src/i18n/scopes.ts) cannot ship. In production the
 * same error is also reported once per key to Sentry (src/components/i18n/IntlBoundary.tsx); e2e builds have no DSN, so that
 * path is inert here and this guard stays the CI gate.
 * A spec that expects such errors opts out with `test.use({ allowIntlErrors: true })`.
 */
export const test = base.extend<{ allowIntlErrors: boolean; intlGuard: void }>({
  allowIntlErrors: [false, { option: true }],
  intlGuard: [
    async ({ page, allowIntlErrors }, use) => {
      const entries: { type: string; text: string }[] = [];
      page.on('console', (m) => entries.push({ type: m.type(), text: m.text() }));
      page.on('pageerror', (e) => entries.push({ type: 'pageerror', text: e.message }));
      // Playwright's console event does not always carry the browser's own "Refused to ..." messages (a blocked
      // `new Function` caught by the page, for one), so also listen for the DOM violation event itself.
      await page.exposeFunction('__e2eCspViolation', (text: string) =>
        entries.push({ type: 'error', text: `Refused to (securitypolicyviolation): ${text}` }),
      );
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) =>
          (window as unknown as { __e2eCspViolation: (t: string) => void }).__e2eCspViolation(
            `${e.violatedDirective} blocked=${e.blockedURI} source=${e.sourceFile}:${e.lineNumber}`,
          ),
        );
      });
      await use();
      // Content-Security-Policy violations are never allowed (e2e runs against the production build, real CSP).
      const csp = findCspProblems(entries);
      if (csp.length) throw new Error(`Content-Security-Policy violations in the browser:\n${csp.join('\n')}`);
      if (!allowIntlErrors) {
        const problems = findIntlProblems(entries);
        if (problems.length) throw new Error(`next-intl problems in the browser:\n${problems.join('\n')}`);
      }
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';

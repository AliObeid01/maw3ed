import type { Page } from '@playwright/test';

/** Collects next-intl problems (a key missing from a message file, a bad ICU message) logged in the browser. */
export function trackIntlErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && /MISSING_MESSAGE|INVALID_MESSAGE|FORMATTING_ERROR|INVALID_KEY/.test(text)) {
      problems.push(text);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

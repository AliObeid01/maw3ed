/** What next-intl logs (console.error) for a missing or broken message. Playwright-free so unit tests can use it. */
export const INTL_ERROR_PATTERN =
  /MISSING_MESSAGE|MISSING_FORMAT|INVALID_MESSAGE|FORMATTING_ERROR|INVALID_KEY|Could not resolve/;

/** The browser console entries that are next-intl problems. */
export function findIntlProblems(
  entries: readonly { type: string; text: string }[],
): string[] {
  return entries
    .filter((e) => (e.type === 'error' || e.type === 'pageerror') && INTL_ERROR_PATTERN.test(e.text))
    .map((e) => (e.type === 'pageerror' ? `pageerror: ${e.text}` : e.text));
}

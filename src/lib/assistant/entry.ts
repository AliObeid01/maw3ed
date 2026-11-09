import { quote } from '@/server/mcp/sanitize';

/**
 * Pure helpers for the PR-15b entry points to the Claude connector (business-page sheet, owner share card).
 * No I/O. A business name is OWNER-ENTERED text, so it goes through the connector's own sanitizer (`quote`: strips
 * control, bidi and zero-width characters, neutralises Markdown and HTML characters, collapses whitespace, caps
 * the length at 80, wraps in plain double quotes with inner quotes swapped). It appears ONLY as that quoted name,
 * never as part of an instruction. The sentences around it live in the message files (en and ar).
 */

/** Where "Open Claude" goes. No prefill parameter: we do not rely on undocumented URL parameters. */
export const CLAUDE_URL = 'https://claude.ai';

/** The sanitized, quoted business name that is safe to place inside a prompt or a share message. */
export const claudeBusinessLabel = (name: unknown): string => quote(name);

/** `<origin>/assistant`, without a doubled slash. */
export function assistantPageUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/assistant`;
}

/** What the builders need from the translator: a message key and its ICU values. */
export type Translate = (key: string, values: Record<string, string>) => string;

/** The prefilled prompt for THIS business (message key `prompt`): quoted name plus the booking-page slug. */
export function claudeBookPrompt(t: Translate, business: { name: string; slug: string }): string {
  return t('prompt', { name: claudeBusinessLabel(business.name), slug: business.slug });
}

/** The ready-to-send share message for an owner (message key `message`). Names the assistant page and the booking page. */
export function claudeShareMessage(
  t: Translate,
  input: { name: string; assistantUrl: string; bookingUrl: string },
): string {
  return t('message', {
    name: claudeBusinessLabel(input.name),
    assistantUrl: input.assistantUrl,
    bookingUrl: input.bookingUrl,
  });
}

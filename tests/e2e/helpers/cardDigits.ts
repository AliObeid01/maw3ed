/**
 * Pure matcher behind the card-digits guard (`cardLeak.ts`), unit-tested in tests/unit/billing/cardDigits.test.ts.
 * A card "leaks" when the haystack (spaces and dashes removed, so "4242 4242" and "4242-4242" and chunks split
 * across fields all count) contains a run of RUN consecutive digits of it. Runs made of ONE repeated digit are
 * ignored: the decline test number 4000 0000 0000 0002 would otherwise match every all-zero id or padding.
 */
export const RUN = 8;

export function cardWindows(card: string): string[] {
  const digits = card.replaceAll(/\D/g, '');
  const out: string[] = [];
  for (let i = 0; i + RUN <= digits.length; i += 1) {
    const w = digits.slice(i, i + RUN);
    if (new Set(w).size > 1) out.push(w);
  }
  return out;
}

/** The first leaked window of any card, or null. */
export function findCardLeak(haystack: string, cards: string[]): string | null {
  const flat = haystack.replaceAll(/[\s-]/g, '');
  for (const card of cards) for (const w of cardWindows(card)) if (flat.includes(w)) return w;
  return null;
}

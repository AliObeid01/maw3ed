/** Distance from the top of the viewport at which a heading counts as "reached": the sticky header (65 px) plus air. */
export const TOC_OFFSET_PX = 96;

/**
 * Which section the reader is in: the last heading whose top has reached the offset line; before the first one
 * has, the first. `tops` is in document order. Pure so the highlight rule is testable without a browser.
 */
export function activeSection(tops: readonly { id: string; top: number }[], offset: number): string | null {
  let active: string | null = tops[0]?.id ?? null;
  for (const { id, top } of tops) {
    if (top <= offset + 1) active = id;
    else break;
  }
  return active;
}

/**
 * Where a heading counts as "reached": a TOC link lands it at `scroll-padding-top` (88 px) plus `scroll-mt-4` (16 px) = 104 px
 * below the viewport top, just under the sticky header (65 px); this line sits a little below that landing spot.
 */
export const TOC_OFFSET_PX = 112;

/**
 * Which section the reader is in: the last heading whose top has reached the offset line; before the first one
 * has, the first; at the very bottom of the page, the last. `tops` is in document order. Pure so the highlight rule is testable without a browser.
 */
export function activeSection(
  tops: readonly { id: string; top: number }[],
  offset: number,
  atBottom = false,
): string | null {
  if (atBottom) return tops.at(-1)?.id ?? null; // the last section may be too short to ever reach the line
  let active: string | null = tops[0]?.id ?? null;
  for (const { id, top } of tops) {
    if (top <= offset + 1) active = id;
    else break;
  }
  return active;
}

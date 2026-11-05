/** Pure placement of an anchored popover (no DOM access, so it is unit-tested). */

export type Rect = { top: number; bottom: number; left: number; right: number; width: number };

export type Placement = {
  top: number;
  left: number;
  maxHeight: number;
  width: number;
  side: 'below' | 'above';
};

const MARGIN = 8;
const GAP = 6;

/**
 * Opens below the anchor when the content fits there (or when there is more room below than above), otherwise above;
 * the height is capped to the room on that side so the content scrolls inside instead of leaving the viewport.
 * Aligns to the anchor's start edge (its right edge in RTL) and slides back inside the viewport horizontally.
 */
export function placePopover(
  anchor: Rect,
  content: { width: number; height: number },
  viewport: { width: number; height: number },
  rtl: boolean,
): Placement {
  const below = viewport.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const side = content.height <= below || below >= above ? 'below' : 'above';
  const room = Math.max(side === 'below' ? below : above, 120);
  const height = Math.min(content.height, room);
  const width = Math.min(content.width, viewport.width - 2 * MARGIN);
  let left = rtl ? anchor.right - width : anchor.left;
  left = Math.min(Math.max(left, MARGIN), viewport.width - MARGIN - width);
  const top = side === 'below' ? anchor.bottom + GAP : anchor.top - GAP - height;
  return { top: Math.max(top, MARGIN), left, maxHeight: room, width, side };
}

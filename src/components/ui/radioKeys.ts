import type { KeyboardEvent } from 'react';

/**
 * Keyboard handling for the ARIA radio-group pattern, to put on the element with `role="radiogroup"`:
 * arrows move focus and select the neighbour (wrapping), Home/End jump to the ends. Horizontal arrows follow
 * the reading direction, so in RTL ArrowLeft goes forward. Pair with `tabIndex={selected ? 0 : -1}` on each radio.
 */
export function radioGroupKeyDown(
  event: KeyboardEvent<HTMLElement>,
  onSelect: (index: number) => void,
) {
  const group = event.currentTarget;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)'));
  const current = radios.indexOf(document.activeElement as HTMLElement);
  if (radios.length === 0 || current === -1) return;
  const rtl = getComputedStyle(group).direction === 'rtl';
  let next: number;
  switch (event.key) {
    case 'ArrowDown':
      next = current + 1;
      break;
    case 'ArrowUp':
      next = current - 1;
      break;
    case 'ArrowRight':
      next = current + (rtl ? -1 : 1);
      break;
    case 'ArrowLeft':
      next = current + (rtl ? 1 : -1);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = radios.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  next = (next + radios.length) % radios.length;
  radios[next]!.focus();
  onSelect(next);
}

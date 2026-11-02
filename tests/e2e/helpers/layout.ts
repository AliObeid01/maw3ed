import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Layout guard (F62): nothing inside `locator` may scroll sideways or stick out of it. A sheet whose content is
 * wider than the sheet gets a hidden horizontal scrollbar and clips controls at one edge, and no assertion on
 * roles or text notices that, so every spec that opens a sheet or a form should call this.
 *
 * Two checks, both with 1 px of slack for sub-pixel rounding:
 *  1. the element and every non-form descendant has `scrollWidth <= clientWidth` (no horizontal scrolling);
 *  2. every visible descendant's box lies inside the element's box (nothing clipped by `overflow: hidden`).
 */
export async function expectNoHorizontalOverflow(locator: Locator, label = 'element') {
  const problems = await locator.evaluate((root) => {
    const found: string[] = [];
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}${
        el.className && typeof el.className === 'string' ? `.${el.className.split(/\s+/).slice(0, 3).join('.')}` : ''
      }`;
    const FORM = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
    const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const el of nodes) {
      if (FORM.has(el.tagName)) continue;
      if (el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1) {
        found.push(`${name(el)} scrolls sideways: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
      }
    }
    const box = root.getBoundingClientRect();
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).position === 'absolute' && r.width <= 1) continue; // sr-only
      if (r.left < box.left - 1 || r.right > box.right + 1) {
        found.push(
          `${name(el)} sticks out: ${Math.round(r.left)}..${Math.round(r.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`,
        );
      }
    }
    return found.slice(0, 6);
  });
  expect(problems, `${label} must not overflow horizontally`).toEqual([]);
}

/** The page itself must not scroll sideways either. */
export async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page must not scroll horizontally').toBeLessThanOrEqual(1);
}

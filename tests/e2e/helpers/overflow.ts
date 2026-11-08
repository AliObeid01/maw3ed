import type { Page } from '@playwright/test';

/** Elements that stick out of the viewport sideways, named so an overflow is diagnosable (empty when none). */
export async function stickingOut(page: Page, scope = 'body'): Promise<string[]> {
  return page.evaluate((root) => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(`${root} *`))) {
      if (el.closest('[data-allow-overflow]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && (r.right > width + 1 || r.left < -1))
        out.push(
          `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${Math.round(r.left)}..${Math.round(r.right)} (viewport ${width})`,
        );
    }
    return out.slice(0, 15);
  }, scope);
}

/** Text zoom to 200% the way a browser setting does: the root font size doubles (every rem doubles). Set through the CSSOM, which the strict CSP allows. */
export async function zoomText200(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
}

import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

// /privacy and /terms: server-rendered drafts, en and ar, with the "Draft - under review" notice.

const PAGES = [
  { path: '/privacy', en: 'Privacy policy', ar: 'سياسة الخصوصية', sections: 14, mentions: ['Vercel', 'Neon', 'Resend', 'Sentry (EU region)', 'where possible', 'rate-limit', 'a phone number', 'not by Maw3ed', 'The business owner can delete a client'] },
  { path: '/terms', en: 'Terms of use', ar: 'شروط الاستخدام', sections: 12, mentions: ['[GOVERNING LAW]', 'test mode'] },
] as const;

for (const p of PAGES) {
  test(`${p.path} (en): heading, draft notice, date, anchors, contact placeholders`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByRole('heading', { level: 1, name: p.en })).toBeVisible();
    await expect(page.getByTestId('legal-draft')).toContainText('Draft - under review');
    await expect(page.getByText('Last updated November 7, 2026')).toBeVisible();
    await expect(page.getByRole('main').locator('section')).toHaveCount(p.sections);
    // Phones: a collapsed "On this page" disclosure; lg and up: the sticky sidebar, already open.
    if ((page.viewportSize()?.width ?? 1280) < 1024) await page.getByTestId('toc-mobile').locator('summary').click();
    const toc = page.getByRole('navigation', { name: 'On this page' });
    await expect(toc.getByRole('link')).toHaveCount(p.sections);
    const text = await page.getByRole('main').innerText();
    for (const m of p.mentions) expect(text).toContain(m);
    expect(text).toContain('hello@[YOUR-DOMAIN]');
    // Each table-of-contents link points at a heading that exists.
    for (const href of await toc.getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('href')!))) {
      await expect(page.locator(`h2${href}`)).toHaveCount(1);
    }
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test(`${p.path} (ar): right to left, translated, Latin digits`, async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await page.goto(p.path);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: p.ar })).toBeVisible();
    await expect(page.getByTestId('legal-draft')).toContainText('مسودة - قيد المراجعة');
    const text = await page.getByRole('main').innerText();
    expect(text).toMatch(/7/);
    expect(text).not.toMatch(/[٠-٩]/);
    await expectNoPageOverflow(page);
  });
}

test('the draft notice is the only thing a lawyer has to flip: it is driven by LEGAL_DRAFT', async () => {
  const { LEGAL_DRAFT } = await import('../../src/lib/site');
  expect(LEGAL_DRAFT).toBe(true);
});

// PR-11 Part B: a table-of-contents link must land with the heading BELOW the 65 px sticky header, the current section is
// highlighted, and on phones the 14 links live in a collapsed disclosure.
for (const [width, height] of [
  [360, 740],
  [1440, 900],
] as const) {
  test(`/privacy TOC at ${width}: the heading lands below the sticky header, the section is highlighted`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/privacy');
    const phone = width < 1024;
    const mobile = page.getByTestId('toc-mobile');
    const desktop = page.getByTestId('toc-desktop');
    if (phone) {
      await expect(desktop).toBeHidden();
      await expect(mobile).toBeVisible();
      await expect(mobile).not.toHaveAttribute('open', ''); // collapsed by default
      await mobile.locator('summary').click();
      await expect(mobile).toHaveAttribute('open', '');
    } else {
      await expect(mobile).toBeHidden();
      await expect(desktop).toBeVisible(); // the sidebar is always open
    }
    const toc = page.getByRole('navigation', { name: 'On this page' });
    const header = (await page.getByRole('banner').boundingBox())!.height;
    const links = toc.getByRole('link');
    const hrefs = await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')!));
    for (const index of [0, 5, hrefs.length - 1]) {
      if (phone && index > 0) await mobile.locator('summary').click(); // it closed after the previous choice
      await links.nth(index).click();
      const id = hrefs[index]!.slice(1);
      const heading = page.locator(`h2[id="${id}"]`);
      await expect(page).toHaveURL(new RegExp(`${hrefs[index]}$`));
      // Smooth scrolling may still be running: wait until the position settles, then measure.
      await expect
        .poll(async () => {
          const a = (await heading.boundingBox())!.y;
          await page.waitForTimeout(150);
          return Math.abs(a - (await heading.boundingBox())!.y) < 0.5 ? Math.round(a) : -9999;
        })
        .toBeGreaterThanOrEqual(Math.floor(header));
      expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(header);
      if (!phone || index === hrefs.length - 1) {
        // Highlight: exactly one link is the current location (the visible list on desktop; re-open on a phone).
        if (phone) await mobile.locator('summary').click();
        await expect(toc.locator('a[aria-current="location"]')).toHaveCount(1);
        await expect(toc.locator('a[aria-current="location"]')).toHaveAttribute('href', hrefs[index]!);
      }
    }
    await expectNoPageOverflow(page);
  });
}

test('smooth scrolling is only enabled when the visitor has not asked for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/privacy');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('smooth');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop)).toBe('88px');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
});

test('/terms TOC: the same offset for the other legal page', async ({ page }) => {
  await page.goto('/terms');
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.getByTestId('toc-mobile').locator('summary').click();
  const toc = page.getByRole('navigation', { name: 'On this page' });
  const header = (await page.getByRole('banner').boundingBox())!.height;
  const last = toc.getByRole('link').last();
  const href = (await last.getAttribute('href'))!;
  await last.click();
  const heading = page.locator(`h2[id="${href.slice(1)}"]`);
  await expect.poll(async () => (await heading.boundingBox())!.y).toBeGreaterThanOrEqual(header);
});

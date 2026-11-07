import { ORIGIN } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

// /privacy and /terms: server-rendered drafts, en and ar, with the "Draft - under review" notice.

const PAGES = [
  { path: '/privacy', en: 'Privacy policy', ar: 'سياسة الخصوصية', sections: 14, mentions: ['Vercel', 'Neon', 'Resend', 'Sentry (EU region)', 'one-way hash'] },
  { path: '/terms', en: 'Terms of use', ar: 'شروط الاستخدام', sections: 12, mentions: ['[GOVERNING LAW]', 'test mode'] },
] as const;

for (const p of PAGES) {
  test(`${p.path} (en): heading, draft notice, date, anchors, contact placeholders`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByRole('heading', { level: 1, name: p.en })).toBeVisible();
    await expect(page.getByTestId('legal-draft')).toContainText('Draft - under review');
    await expect(page.getByText('Last updated November 7, 2026')).toBeVisible();
    await expect(page.getByRole('main').locator('section')).toHaveCount(p.sections);
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

import type { Page } from '@playwright/test';
import { PLAN_PRICE } from '../../src/server/domain/plan';
import { ORIGIN } from './helpers/clock';
import { mockExplore } from './helpers/explore';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

// PR-13: the plans live on /for-business#plans (the old /pricing redirects there), every owner CTA goes to them, the
// header owners button and the hero use ONE navy, and the two example cards have new copy.

const PLANS = '/for-business#plans';
const header = (page: Page) => page.getByRole('banner');
const ownersButton = (page: Page) => header(page).getByRole('link', { name: /For (business )?owners/ }).first();
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 1280) >= 1024;
const NAVY = 'rgb(11, 25, 56)'; // --color-navy #0b1938

test.describe('plans section', () => {
  test('two plan cards, each with its own full-width button; no See all plans, no Every plan includes', async ({ page }) => {
    await page.goto('/for-business');
    const plans = page.locator('section#plans');
    await expect(plans).toHaveCount(1);
    await expect(plans.getByRole('heading', { level: 2, name: 'Simple pricing' })).toBeVisible();
    await expect(plans.getByRole('link', { name: 'See all plans' })).toHaveCount(0);
    await expect(plans.getByText('Every plan includes')).toHaveCount(0);
    await expect(plans.getByRole('link')).toHaveCount(2); // exactly the two plan buttons

    const free = plans.locator('#teaser-free').locator('xpath=ancestor::article');
    const pro = plans.locator('#teaser-pro').locator('xpath=ancestor::article');
    await expect(free.getByTestId('plan-cta-free')).toHaveText('Start Free');
    await expect(free.getByTestId('plan-cta-free')).toHaveAttribute('href', '/signup');
    await expect(pro.getByTestId('plan-cta-pro')).toHaveText('Upgrade to Pro');
    await expect(pro.getByTestId('plan-cta-pro')).toHaveAttribute('href', '/signup?plan=pro');
    // Price from the single constant; the test-mode chip and sentence and the Recommended chip stay.
    await expect(pro).toContainText(`$${PLAN_PRICE.PRO.amount}`);
    await expect(pro).toContainText('TEST MODE');
    await expect(pro).toContainText('Test mode: checkout is simulated and no card is charged.');
    await expect(pro).toContainText('Recommended');

    // 44 px+, full width, the same height, bottoms aligned (cards are equal height on md+).
    await free.scrollIntoViewIfNeeded();
    const fb = (await free.getByTestId('plan-cta-free').boundingBox())!;
    const pb = (await pro.getByTestId('plan-cta-pro').boundingBox())!;
    const fc = (await free.boundingBox())!;
    const pc = (await pro.boundingBox())!;
    expect(fb.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(fb.height - pb.height)).toBeLessThanOrEqual(1);
    expect(fb.width).toBeGreaterThan(fc.width - 80);
    expect(pb.width).toBeGreaterThan(pc.width - 80);
    if (pc.x > fc.x + fc.width - 2) {
      expect(Math.abs(fc.height - pc.height), 'equal card heights').toBeLessThanOrEqual(1);
      expect(Math.abs(fb.y + fb.height - (pb.y + pb.height)), 'buttons aligned at the bottom').toBeLessThanOrEqual(1);
    }
    await expectNoPageOverflow(page);
  });

  test('the old /pricing page is gone: ONE permanent redirect (308) to /for-business#plans, no link anywhere', async ({ page, request }) => {
    const res = await request.get('/pricing', { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()['location']).toMatch(/\/for-business#plans$/);
    await page.goto('/pricing');
    await expect(page).toHaveURL(/\/for-business#plans$/);
    await expect(page.locator('section#plans')).toBeVisible();
    for (const path of ['/for-business', '/how-it-works', '/privacy']) {
      await page.goto(path);
      await expect(page.locator('a[href="/pricing"]')).toHaveCount(0);
    }
  });

  test('the wrapper with id="plans" is not inside a Reveal (a link to it always finds a visible target)', async ({ page }) => {
    await page.goto('/for-business');
    await expect(page.locator('[data-revealed] section#plans, [data-revealed]#plans')).toHaveCount(0);
    expect(await page.evaluate(() => !!document.getElementById('plans')?.closest('[data-revealed]'))).toBe(false);
  });
});

for (const motion of ['no-preference', 'reduce'] as const) {
  test.describe(`landing on #plans (${motion} motion)`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
    });

    async function expectLandedBelowHeader(page: Page) {
      const plans = page.locator('section#plans');
      const h = (await header(page).boundingBox())!.height;
      await expect
        .poll(async () => {
          const a = (await plans.boundingBox())!.y;
          await page.waitForTimeout(200);
          return Math.abs(a - (await plans.boundingBox())!.y) < 0.5 ? Math.round(a) : -9999;
        })
        .toBeGreaterThanOrEqual(Math.floor(h));
      // 88 px scroll-padding: the section's top edge sits right under the sticky header, not behind it.
      expect((await plans.boundingBox())!.y).toBeLessThan(h + 60);
      await expect(page.locator('#teaser-pro')).toBeInViewport();
      // The cards are visible (not left hidden by a Reveal) after the jump.
      await expect.poll(async () => page.locator('#teaser-pro').locator('xpath=ancestor::*[@data-revealed][1]').getAttribute('data-revealed')).toBe('true');
      expect(await page.locator('#teaser-pro').locator('xpath=ancestor::article').evaluate((el) => getComputedStyle(el.parentElement!).opacity)).toBe('1');
    }

    test('the hero button on /for-business scrolls to the plans, below the header', async ({ page }) => {
      await page.goto('/for-business');
      const hero = page.getByRole('region', { name: 'Every no-show is a paid hour lost.' });
      await hero.getByRole('link', { name: 'Put your business on Maw3ed' }).click();
      await expect(page).toHaveURL(/\/for-business#plans$/);
      await expectLandedBelowHeader(page);
    });

    test('the closing band on the home navigates there from another page', async ({ page }) => {
      await mockExplore(page);
      await page.goto('/');
      const band = page.getByRole('region', { name: 'Run a salon, barbershop or clinic?' });
      await band.scrollIntoViewIfNeeded();
      await band.getByRole('link', { name: 'Put your business on Maw3ed' }).click();
      await expect(page).toHaveURL(/\/for-business#plans$/);
      await expect(page.locator('section#plans')).toBeVisible();
      await expectLandedBelowHeader(page);
    });
  });
}

test('every public owner CTA points at the plans; Business sign in and the header button keep their targets', async ({ page }) => {
  await mockExplore(page);
  await page.goto('/');
  const band = page.getByRole('region', { name: 'Run a salon, barbershop or clinic?' });
  await expect(band.getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', PLANS);
  await expect(band.getByRole('link', { name: 'Business sign in' })).toHaveAttribute('href', '/login');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', PLANS);
  await expect(ownersButton(page)).toHaveAttribute('href', '/for-business');
  if (isDesktop(page)) await expect(header(page).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  await page.goto('/how-it-works');
  await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', PLANS);
});

test.describe('one header button, one hero colour', () => {
  async function colours(page: Page, path: string) {
    await mockExplore(page);
    await page.goto(path);
    const button = ownersButton(page);
    await expect(button).toBeVisible();
    return button.evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, border: s.borderTopColor, radius: s.borderTopLeftRadius, current: el.getAttribute('aria-current') };
    });
  }

  test('the For business owners button has an identical computed look on /, /for-business, /how-it-works, /directory', async ({ page }) => {
    const seen = [];
    for (const path of ['/', '/for-business', '/how-it-works', '/directory'])
      seen.push({ path, ...(await colours(page, path)) });
    for (const s of seen) {
      expect(s.bg, `${s.path} background`).toBe(NAVY);
      expect(s.color, `${s.path} text`).toBe('rgb(255, 255, 255)');
    }
    expect(new Set(seen.map((s) => `${s.bg}|${s.color}|${s.border}|${s.radius}`)).size).toBe(1);
    // The current page is signalled with aria-current, never with another colour.
    expect(seen.find((s) => s.path === '/for-business')!.current).toBe('page');
    expect(seen.find((s) => s.path === '/')!.current).toBeNull();
  });

  test('hover and focus look the same on the current page and on another page', async ({ page }) => {
    const state = async (path: string) => {
      await mockExplore(page);
      await page.goto(path);
      const button = ownersButton(page);
      await button.hover();
      await page.waitForTimeout(350);
      const hover = await button.evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.mouse.move(0, 400);
      await button.focus();
      const focus = await button.evaluate((el) => { const s = getComputedStyle(el); return `${s.backgroundColor}|${s.outlineStyle}|${s.outlineWidth}`; });
      return { hover, focus };
    };
    if (!isDesktop(page)) test.skip(true, 'hover is a desktop state');
    expect(await state('/for-business')).toEqual(await state('/how-it-works'));
  });

  test('the /for-business hero is the SAME navy as the home hero (flat), with readable buttons', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/');
    const homeHero = await page.locator('main section[data-surface="dark"]').first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(homeHero).toBe(NAVY);
    await page.goto('/for-business');
    const hero = page.getByRole('region', { name: 'Every no-show is a paid hour lost.' });
    expect(await hero.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(homeHero);
    expect(await hero.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none');
    // Turquoise primary with navy text, outlined sign-in, white Today card.
    const primary = hero.getByRole('link', { name: 'Put your business on Maw3ed' });
    expect(await primary.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(33, 205, 179)'); // --color-turquoise #21cdb3
    expect(await primary.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(11, 25, 56)');
    const signIn = hero.getByRole('link', { name: 'Business sign in' });
    expect(await signIn.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await signIn.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
    expect(await hero.getByTestId('owner-phone').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    // No other large band on the page is Royal Blue (#254edb).
    const blueBands = await page.evaluate(() =>
      [...document.querySelectorAll('main section, main > div')].filter((el) => {
        const r = el.getBoundingClientRect();
        return getComputedStyle(el).backgroundColor === 'rgb(37, 78, 219)' && r.width > 300 && r.height > 120;
      }).length,
    );
    expect(blueBands).toBe(0);
  });
});

test.describe('example cards copy', () => {
  test('/for-business Today card: row 1 unchanged, Nails + Mask / Maria, Check-up / Dr. Elias; decorative with the Example chip', async ({ page }) => {
    await page.goto('/for-business');
    const card = page.getByTestId('owner-phone');
    await expect(card).toHaveAttribute('aria-hidden', 'true');
    await expect(card).toContainText('Example');
    await expect(card).toContainText('Rami Haddad');
    await expect(card).toContainText('Haircut · Karam');
    await expect(card).toContainText('Confirmed');
    await expect(card).toContainText('Lina Saab');
    await expect(card).toContainText('Nails + Mask · Maria');
    await expect(card).toContainText('Booked');
    await expect(card).toContainText('Karim Awad');
    await expect(card).toContainText('Check-up · Dr. Elias');
    await expect(card).toContainText('Cancelled');
    for (const gone of ['Cut + beard', 'Hadi', 'Beard trim']) await expect(card).not.toContainText(gone);
  });

  test('/for-business Today card in Arabic: natural names, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await page.goto('/for-business');
    const card = page.getByTestId('owner-phone');
    await expect(card).toContainText('قصّة شعر · كرم');
    await expect(card).toContainText('أظافر + ماسك · ماريا');
    await expect(card).toContainText('فحص · د. إلياس');
    await expectNoPageOverflow(page);
  });

  test('/how-it-works reminder illustration uses Beauty Center and Leen, in the real email words', async ({ page, context }) => {
    await page.goto('/how-it-works');
    const preview = page.getByTestId('email-preview');
    await expect(preview).toHaveAttribute('aria-hidden', 'true');
    await expect(preview).toContainText('Illustration');
    await expect(preview).toContainText('This is a reminder of your appointment at Beauty Center.');
    await expect(preview).toContainText('Haircut · 30 min · with Leen');
    await expect(preview).not.toContainText(/Abu Karam|Karam/);
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await page.goto('/how-it-works');
    await expect(page.getByTestId('email-preview')).toContainText('بيوتي سنتر');
    await expect(page.getByTestId('email-preview')).toContainText('مع لين');
    await expectNoPageOverflow(page);
  });
});

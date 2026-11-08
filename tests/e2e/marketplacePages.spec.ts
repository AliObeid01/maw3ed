import type { Page } from '@playwright/test';
import { ORIGIN } from './helpers/clock';
import { mockExplore } from './helpers/explore';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';
import { saved, seedBookings } from './helpers/myBookings';

// PR-11: /how-it-works, /for-business, the header and phone tab bar on every marketplace page, cross-page anchors and
// navigation feedback. Static pages: nothing here needs the API except the header's saved-bookings lookup (local).

const WIDTHS = [
  [320, 700],
  [360, 740],
  [1440, 900],
] as const;

const header = (page: Page) => page.getByRole('banner');
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 1280) >= 1024;

test.describe('/how-it-works', () => {
  test('the three steps, the real reminder email, the actionable bullets, the FAQ, an Explore button', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How Maw3ed works');
    await expect(page).toHaveTitle(/How Maw3ed works/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/how-it-works$/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /three steps/);
    await expect(page.getByRole('heading', { level: 3 })).toContainText([
      /Choose a service and a person/,
      /Pick a free time/,
      /Get your reminder/,
    ]);
    const reminders = page.locator('#reminders');
    await expect(reminders.getByRole('heading', { name: 'A reminder you can act on' })).toBeVisible();
    await expect(reminders).toContainText('Confirm your appointment in one tap');
    const preview = page.getByTestId('email-preview');
    await expect(preview).toHaveAttribute('aria-hidden', 'true');
    // The words are the real ones (email.h24 and email.actions), labelled as an illustration.
    await expect(preview).toContainText('Your appointment is tomorrow');
    await expect(preview).toContainText('This is a reminder of your appointment at Abu Karam Barbershop.');
    await expect(preview).toContainText('Confirm my appointment');
    await expect(preview).toContainText('Cancel my appointment');
    await expect(preview).toContainText('Illustration');
    await expect(preview.locator('a, button')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText(/your reference|next 30 days|Help centre/i);

    // The FAQ is native <details>: it works from the keyboard and keeps the My bookings answer.
    const faq = page.locator('#faq');
    await expect(faq.locator('details')).toHaveCount(5);
    await expect(faq.getByText('Can I see my bookings later?')).toBeAttached();
    const first = faq.getByText('Do I need an account?');
    const details = faq.locator('details').first();
    await first.focus();
    await expect(details).not.toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    await expect(details).toContainText('name, phone and email');
    await page.keyboard.press('Space');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(faq.locator('details').nth(1)).toContainText(
      'The booking email has a Cancel link (and a Confirm link when the visit is within 24 hours); every reminder has both.',
    );
    await expect(page.getByRole('main').getByRole('link', { name: 'Explore businesses' })).toHaveAttribute('href', '/directory');
  });

  for (const [w, h] of WIDTHS) {
    test(`no horizontal overflow at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/how-it-works');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoPageOverflow(page);
    });
  }

  test('Arabic: right to left, translated, Latin digits, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await page.goto('/how-it-works');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('كيف يعمل موعد');
    await expect(page.locator('#faq details').first()).toContainText('هل أحتاج');
    // The email illustration uses the real Arabic reminder wording.
    await expect(page.getByTestId('email-preview')).toContainText('تأكيد موعدي');
    expect(await page.locator('main').innerText()).not.toMatch(/[٠-٩۰-۹]/);
    await expectNoPageOverflow(page);
  });

  test('anchors land with the heading below the sticky header: from the footer link and from a direct URL', async ({ page }) => {
    await mockExplore(page);
    // The settled top of an element: smooth scrolling may still be running right after the click.
    const settledTop = async (selector: string) => {
      const target = page.locator(selector);
      let last = Number.NaN;
      await expect
        .poll(async () => {
          const y = (await target.boundingBox())!.y;
          const stable = Math.abs(y - last) < 0.5;
          last = y;
          return stable ? Math.round(y) : -9999;
        })
        .not.toBe(-9999);
      return (await target.boundingBox())!.y;
    };
    await page.goto('/');
    await page.getByRole('contentinfo').getByRole('link', { name: 'Reminders and confirmations' }).click();
    await expect(page).toHaveURL(`${ORIGIN}/how-it-works#reminders`);
    const head = (await header(page).boundingBox())!.height;
    expect(await settledTop('#reminders')).toBeGreaterThanOrEqual(head);
    await page.goto('/how-it-works#faq');
    expect(await settledTop('#faq')).toBeGreaterThanOrEqual(head);
  });
});

test.describe('/for-business', () => {
  test('the Royal Blue band, the fake Today card, five TRUE steps, the same plans as /pricing, what every plan includes', async ({ page }) => {
    await page.goto('/for-business');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every no-show is a paid hour lost.');
    await expect(page).toHaveTitle(/business owners/i);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/for-business$/);
    const band = page.getByRole('region', { name: 'Every no-show is a paid hour lost.' });
    await expect(band.getByRole('link', { name: 'Put your business on Maw3ed' })).toHaveAttribute('href', '/signup');
    await expect(band.getByRole('link', { name: 'Business sign in' })).toHaveAttribute('href', '/login');
    await expect(band.getByTestId('owner-phone')).toHaveAttribute('aria-hidden', 'true');
    await expect(band.getByTestId('owner-phone')).toContainText('Example');

    const steps = page.getByRole('region', { name: 'Set up in five steps' }).getByRole('listitem');
    await expect(steps).toHaveCount(5);
    await expect(steps).toContainText([
      /Business profile.*Name, category, area and address/,
      /Services.*Name, duration and price/,
      /Staff.*Each person can get a login and sees only their own appointments/,
      /Working hours.*Seven days, with a closed toggle/,
      /Publish.*Share your link on Instagram or WhatsApp/,
    ]);

    const teaser = page.getByRole('region', { name: 'Simple pricing' });
    await expect(teaser).toContainText('Free');
    await expect(teaser).toContainText('Pro');
    await expect(teaser).not.toContainText(/Solo|Clinic|\[XX\]|\[N\]/);
    await expect(teaser.getByRole('link', { name: 'See all plans' })).toHaveAttribute('href', '/pricing');
    const free = await teaser.locator('#teaser-free').locator('xpath=ancestor::article').innerText();
    const pro = await teaser.locator('#teaser-pro').locator('xpath=ancestor::article').innerText();
    // Only real features: every item of "Every plan includes" is a Free feature key (Pro is "Everything in Free").
    const includes = teaser.getByRole('region', { name: 'Every plan includes' });
    await expect(includes.getByRole('listitem')).toHaveText([
      'Your own booking page',
      'Email reminders 24 h and 2 h before',
      'One-tap WhatsApp reminders',
      'Waitlist and no-show history',
    ]);
    await page.goto('/pricing');
    const freePlan = await page.locator('section[aria-labelledby="plan-free"]').innerText();
    const proPlan = await page.locator('section[aria-labelledby="plan-pro"]').innerText();
    for (const line of ['$0', '/ month', 'Your own booking page', 'Email reminders 24 h and 2 h before']) {
      expect(free).toContain(line);
      expect(freePlan).toContain(line);
    }
    for (const line of ['$9', 'Everything in Free', 'More than one bookable staff member', 'TEST MODE']) {
      expect(pro).toContain(line);
      expect(proPlan).toContain(line);
    }
  });

  for (const [w, h] of WIDTHS) {
    test(`no horizontal overflow at ${w}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/for-business');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoPageOverflow(page);
    });
  }

  test('Arabic: right to left, Latin digits, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: ORIGIN }]);
    await page.goto('/for-business');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('كل موعد فائت');
    expect(await page.locator('main').innerText()).not.toMatch(/[٠-٩۰-۹]/);
    await expectNoPageOverflow(page);
  });
});

test.describe('header and tab bar per page', () => {
  const PAGES = [
    { path: '/', current: 'Explore' },
    { path: '/directory', current: 'Explore' },
    { path: '/how-it-works', current: 'How it works' },
    { path: '/for-business', current: 'For business owners' },
    { path: '/pricing', current: null },
    { path: '/privacy', current: null },
    { path: '/my-bookings', current: null },
  ] as const;

  for (const { path, current } of PAGES) {
    test(`${path}: the right item is aria-current, owners button goes to /for-business`, async ({ page }) => {
      await mockExplore(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const owners = header(page).getByRole('link', { name: /For (business )?owners/ });
      await expect(owners.first()).toHaveAttribute('href', '/for-business');
      if (current === 'For business owners') await expect(owners.first()).toHaveAttribute('aria-current', 'page');
      else await expect(owners.first()).not.toHaveAttribute('aria-current', 'page');
      const nav = isDesktop(page)
        ? page.getByRole('navigation', { name: 'Site' })
        : page.getByRole('navigation', { name: 'Main' });
      const items = nav.getByRole('link');
      await expect(items).toHaveText(['Explore', 'How it works']);
      for (const name of ['Explore', 'How it works']) {
        const link = nav.getByRole('link', { name, exact: true });
        if (name === current) await expect(link).toHaveAttribute('aria-current', 'page');
        else await expect(link).not.toHaveAttribute('aria-current', 'page');
      }
      await expect(nav.getByRole('link', { name: 'Explore' })).toHaveAttribute('href', '/');
      await expect(nav.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', '/how-it-works');
      await expect(page.getByRole('link', { name: 'Pricing' }).first()).toBeVisible(); // the footer still has it
      await expect(header(page).getByRole('link', { name: 'Pricing' })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Pricing' })).toHaveCount(0);
      await expect(header(page).getByRole('button', { name: 'عربي' })).toBeVisible();
      if (isDesktop(page)) await expect(header(page).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    });
  }

  test('with saved bookings: My bookings joins the header (wide) and the tab bar (phone)', async ({ page }) => {
    await mockExplore(page);
    await seedBookings(page, [saved()]);
    await page.goto('/how-it-works');
    const nav = isDesktop(page)
      ? page.getByRole('navigation', { name: 'Site' })
      : page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link')).toHaveText(isDesktop(page) ? ['Explore', 'My bookings', 'How it works'] : ['Explore', 'How it works', 'My bookings']);
    await expect(nav.getByRole('link', { name: 'My bookings' })).toHaveAttribute('href', '/my-bookings');
    await expect(nav.getByRole('link', { name: 'How it works' })).toHaveAttribute('aria-current', 'page');
  });

  test('no page links to the old #how anchor', async ({ page }) => {
    for (const path of ['/', '/how-it-works', '/for-business', '/pricing', '/directory']) {
      await mockExplore(page);
      await page.goto(path);
      await expect(page.locator('a[href*="#how"]')).toHaveCount(0);
    }
  });

  for (const [w, h] of [
    [320, 700],
    [390, 800],
    [768, 1024],
    [1440, 900],
  ] as const) {
    test(`the header fits at ${w} (logo, language, owners button; no overflow)`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await mockExplore(page);
      await page.goto('/how-it-works');
      for (const link of await header(page).getByRole('link').all()) {
        if (await link.isVisible()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
      }
      await expectNoPageOverflow(page);
    });
  }
});

test.describe('navigation feedback', () => {
  test('a slow client navigation shows the top progress bar and aria-busy on the clicked link, then clears', async ({ page }) => {
    await mockExplore(page);
    await page.goto('/');
    await page.route(/how-it-works.*_rsc|_rsc.*how-it-works/, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'How it works', exact: true });
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await expect(page.getByTestId('nav-progress')).toBeVisible();
    await expect(link).toHaveAttribute('aria-busy', 'true');
    await expect(page).toHaveURL(`${ORIGIN}/how-it-works`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How Maw3ed works');
    await expect(page.getByTestId('nav-progress')).toHaveCount(0);
  });

  test('the progress bar is static with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockExplore(page);
    await page.goto('/');
    await page.route(/how-it-works.*_rsc|_rsc.*how-it-works/, async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'How it works', exact: true });
    await link.scrollIntoViewIfNeeded();
    await link.click();
    const bar = page.getByTestId('nav-progress');
    await expect(bar).toBeVisible();
    expect(await bar.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How Maw3ed works');
  });
});

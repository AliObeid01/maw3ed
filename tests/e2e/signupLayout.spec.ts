import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';

// F66 part D: the Sign up card is 640 px wide with a two-column form from md (768 px), one tight column on phones,
// and the Create account button is visible without scrolling at common desktop sizes. Self-contained: the only
// API call (slug availability) is answered by page.route.

// The booking link input sits behind a "/b/" prefix inside its bordered box: measure the box, not the input.
const field = (page: Page, name: string): Locator => {
  const control = page.locator(`[name=${name}]`);
  return name === 'slug' ? control.locator('xpath=..') : control;
};
const box = async (l: Locator) => (await l.boundingBox())!;

async function open(
  page: Page,
  viewport: { width: number; height: number },
  siteUrl: string,
  locale = 'en',
) {
  await page.context().addCookies([{ name: 'locale', value: locale, url: siteUrl }]);
  await page.setViewportSize(viewport);
  await page.route('**/api/auth/slug-check**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) }),
  );
  await page.goto('/signup');
  await expect(field(page, 'businessName')).toBeVisible();
}

const NAMES = ['businessName', 'slug', 'ownerName', 'email', 'password', 'timezone'] as const;

test.describe('sign up layout', () => {
  for (const [label, viewport] of [
    ['768x1024', { width: 768, height: 1024 }],
    ['1280x720', { width: 1280, height: 720 }],
    ['1440x900', { width: 1440, height: 900 }],
  ] as const) {
    test(`${label}: two columns in the order name|link, you|email, password|timezone`, async ({ page, baseURL }) => {
      await open(page, viewport, baseURL!);
      const b = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await box(field(page, n))])));
      const card = await box(page.locator('main section').first());
      expect(card.width, 'the card widens to about 640 px').toBeGreaterThan(560);
      expect(card.width).toBeLessThanOrEqual(641);
      for (const [left, right] of [
        ['businessName', 'slug'],
        ['ownerName', 'email'],
        ['password', 'timezone'],
      ] as const) {
        const l = b[left]!;
        const r = b[right]!;
        expect(Math.abs(l.y - r.y), `${left} and ${right} share a row`).toBeLessThanOrEqual(2);
        expect(r.x, `${right} is in the second column`).toBeGreaterThanOrEqual(l.x + l.width);
      }
      expect(b.ownerName!.y).toBeGreaterThan(b.businessName!.y + 40);
      expect(b.password!.y).toBeGreaterThan(b.ownerName!.y + 40);
      // The strength meter and its hint stay under the password field.
      const strength = await box(page.getByRole('group', { name: 'Password strength' }));
      expect(strength.y).toBeGreaterThan(b.password!.y);
      expect(Math.abs(strength.x - b.password!.x)).toBeLessThanOrEqual(2);
      await expectNoPageOverflow(page);
    });
  }

  for (const [label, viewport] of [
    ['1280x720', { width: 1280, height: 720 }],
    ['1440x900', { width: 1440, height: 900 }],
  ] as const) {
    test(`${label}: Create account is visible and full width without scrolling`, async ({ page, baseURL }) => {
      await open(page, viewport, baseURL!);
      const button = page.getByRole('button', { name: 'Create account' });
      await expect(button).toBeInViewport({ ratio: 1 });
      const scrolled = await page.evaluate(() => window.scrollY);
      expect(scrolled).toBe(0);
      const b = await box(button);
      expect(b.height).toBeGreaterThanOrEqual(44);
      const first = await box(field(page, 'businessName'));
      const last = await box(field(page, 'timezone'));
      expect(Math.abs(b.x - first.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(b.x + b.width - (last.x + last.width))).toBeLessThanOrEqual(2);
      // Typing a business name fills the link and shows its address and availability; the button must not move
      // once the address line is there, nor when the availability arrives.
      await field(page, 'businessName').fill('Studio Nour');
      await expect(page.locator('[name=slug]')).toHaveValue('studio-nour');
      await expect(page.getByText('Available', { exact: true })).toBeVisible();
      await expect(button).toBeInViewport({ ratio: 1 });
    });
  }

  test('360: one column, tight, nothing overflows, targets are 44 px', async ({ page, baseURL }) => {
    await open(page, { width: 360, height: 740 }, baseURL!);
    const b = Object.fromEntries(await Promise.all(NAMES.map(async (n) => [n, await box(field(page, n))])));
    let previous = -1;
    for (const n of NAMES) {
      const r = b[n]!;
      expect(Math.abs(r.x - b.businessName!.x), `${n} is in the single column`).toBeLessThanOrEqual(2);
      expect(r.y, `${n} is below the previous field`).toBeGreaterThan(previous);
      expect(r.height).toBeGreaterThanOrEqual(44);
      previous = r.y;
    }
    // Tight: the gap between two stacked simple fields (name -> email) is at most label + gap + 16 px.
    const gap = b.email!.y - (b.ownerName!.y + b.ownerName!.height);
    expect(gap).toBeLessThanOrEqual(48);
    await expectNoPageOverflow(page);
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  for (const [label, viewport] of [
    ['360x740', { width: 360, height: 740 }],
    ['1280x720', { width: 1280, height: 720 }],
  ] as const) {
    test(`${label}: the link status line is reserved from the first render, so typing moves nothing`, async ({ page, baseURL }) => {
      await open(page, viewport, baseURL!);
      const button = page.getByRole('button', { name: 'Create account' });
      const slug = page.locator('[name=slug]');
      const card = page.locator('main section').first();
      const snapshot = async () => ({
        button: (await box(button)).y,
        form: (await box(page.locator('form').first())).height,
        card: (await box(card)).height,
      });
      // The preview and status lines never wrap or grow: one line of at most 19 px each.
      const lines = async () =>
        page.locator('[name=slug]').evaluate((input) => {
          const wrap = input.closest('div')!.nextElementSibling!;
          const [preview, status] = Array.from(wrap.children) as HTMLElement[];
          return {
            previewH: preview!.getBoundingClientRect().height,
            previewTruncated: preview!.scrollWidth > preview!.clientWidth,
            statusH: status!.getBoundingClientRect().height,
            statusWraps: Array.from(status!.querySelectorAll('span')).some((n) => n.getBoundingClientRect().height > 20),
          };
        });
      const idle = await snapshot();
      await slug.fill('studio-nour');
      const typed = await snapshot();
      await expect(page.getByText('Available', { exact: true })).toBeVisible();
      const available = await snapshot();
      await slug.fill('x');
      await expect(page.getByText(/Use 3 to 40/)).toBeVisible();
      const invalid = await snapshot();

      // "Checking": hold the slug-check answer, wait until the slow-server text shows, measure, then release.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.unroute('**/api/auth/slug-check**');
      await page.route('**/api/auth/slug-check**', async (route) => {
        await gate;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) });
      });
      await slug.fill('held-address');
      await expect(page.getByText('Checking availability…')).toBeVisible();
      const checking = await snapshot();
      expect((await lines()).statusWraps).toBe(false);
      release();
      await expect(page.getByText('Available', { exact: true })).toBeVisible();

      // The longest allowed address (the input's own maxLength) must truncate, not wrap into extra height.
      const max = Number(await slug.getAttribute('maxlength'));
      expect(max, 'the slug input has a maxLength').toBeGreaterThan(20);
      const longest = ('ab-'.repeat(max).slice(0, max - 1) + 'z').toLowerCase();
      await slug.fill(longest + 'EXTRA-IGNORED');
      await expect(slug).toHaveValue(longest);
      expect(longest).toHaveLength(max);
      await expect(page.getByText('Available', { exact: true })).toBeVisible();
      const long = await snapshot();
      const longLines = await lines();
      expect(longLines.previewH, 'preview stays one line').toBeLessThanOrEqual(20);
      expect(longLines.statusH, 'status stays one line').toBeLessThanOrEqual(20);
      expect(longLines.statusWraps).toBe(false);
      if (viewport.width <= 400) expect(longLines.previewTruncated, 'the long address really is cut with an ellipsis').toBe(true);
      for (const [name, state] of Object.entries({ typed, available, invalid, checking, long })) {
        expect(Math.abs(state.button - idle.button), `button y after ${name}`).toBeLessThanOrEqual(1);
        expect(Math.abs(state.form - idle.form), `form height after ${name}`).toBeLessThanOrEqual(1);
        expect(Math.abs(state.card - idle.card), `card height after ${name}`).toBeLessThanOrEqual(1);
      }
      await expectNoPageOverflow(page);
      if (viewport.width > 1000) await expect(button).toBeInViewport({ ratio: 1 });
    });
  }

  test('Arabic: two columns at md and one at 360, RTL, no overflow, button in view', async ({ page, baseURL }) => {
    await open(page, { width: 1280, height: 720 }, baseURL!, 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const biz = await box(field(page, 'businessName'));
    const slug = await box(field(page, 'slug'));
    expect(Math.abs(biz.y - slug.y)).toBeLessThanOrEqual(2);
    expect(slug.x + slug.width, 'RTL: the link field is to the left of the name field').toBeLessThanOrEqual(biz.x + 1);
    await expect(page.locator('button[type=submit]')).toBeInViewport({ ratio: 1 });
    await expectNoPageOverflow(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await expect(page.locator('button[type=submit]')).toBeVisible();
    await expectNoPageOverflow(page);
  });
});

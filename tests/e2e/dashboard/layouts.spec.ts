import { type Locator, type Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { expectNoPageOverflow } from '../helpers/layout';
import { mockSetupApi, setRole } from '../helpers/mockApi';

// F66 parts B and C: Settings puts the Plan box beside Deposits, Account puts its two cards side by side, both
// only from `lg` (1024 px) up. Below that everything is one column. Every API call is answered by page.route.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.setTimeout(90_000);

const WIDE = { width: 1440, height: 900 };
const BELOW_LG = { width: 900, height: 900 };
const PHONE = { width: 360, height: 800 };

const box = async (l: Locator) => (await l.boundingBox())!;

async function settings(page: Page) {
  await setRole(page, 'OWNER', DASHBOARD);
  await mockSetupApi(page);
  await page.goto('/app/settings');
  const deposits = page.getByRole('region', { name: 'Deposits for repeat no-shows' });
  const plan = page.locator('section[aria-labelledby="plan-card-title"]');
  await expect(deposits).toBeVisible();
  await expect(plan).toBeVisible();
  return { deposits, plan };
}

test.describe('Settings (part B)', () => {
  test('at lg+ the Plan box sits next to Deposits in the right column, top aligned', async ({ page }) => {
    await page.setViewportSize(WIDE);
    const { deposits, plan } = await settings(page);
    const d = await box(deposits);
    const p = await box(plan);
    expect(p.x, 'Plan starts after Deposits ends (side by side)').toBeGreaterThanOrEqual(d.x + d.width);
    expect(Math.abs(p.y - d.y), 'same top edge').toBeLessThanOrEqual(1);
    // The right column is the same one the Rules card uses.
    const rules = await box(page.getByRole('region', { name: 'Booking rules' }));
    expect(Math.abs(p.x - rules.x)).toBeLessThanOrEqual(1);
    await expectNoPageOverflow(page);
  });

  for (const [name, viewport] of [['900', BELOW_LG], ['360', PHONE]] as const) {
    test(`below lg (${name}) it is one column: Deposits, then Plan`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { deposits, plan } = await settings(page);
      const d = await box(deposits);
      const p = await box(plan);
      expect(Math.abs(p.x - d.x)).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(d.y + d.height - 1);
      await expectNoPageOverflow(page);
    });
  }
});

test.describe('Account (part C)', () => {
  async function account(page: Page) {
    await setRole(page, 'OWNER', DASHBOARD);
    await mockSetupApi(page);
    await page.goto('/app/account');
    const profile = page.getByRole('region', { name: 'Your sign-in' });
    const card = page.getByRole('region', { name: 'Account', exact: true });
    const signOut = card.getByRole('button', { name: 'Sign out', exact: true });
    const others = card.getByRole('button', { name: 'Sign out other devices', exact: true });
    await expect(profile).toBeVisible();
    await expect(card).toBeVisible();
    await expect(signOut).toBeVisible();
    return { profile, card, signOut, others };
  }

  test('at lg+ Your sign-in and Account are side by side, top aligned; Sign out sits next to Sign out other devices inside the card', async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    const { profile, card, signOut, others } = await account(page);
    const a = await box(profile);
    const b = await box(card);
    expect(b.x, 'Account is beside Your sign-in').toBeGreaterThanOrEqual(a.x + a.width);
    expect(Math.abs(a.y - b.y), 'top aligned').toBeLessThanOrEqual(1);
    expect(Math.abs(a.width - b.width), 'equal widths').toBeLessThanOrEqual(2);
    const s = await box(signOut);
    const o = await box(others);
    expect(Math.abs(s.y - o.y), 'one row').toBeLessThanOrEqual(1);
    expect(s.x, 'Sign out comes first').toBeLessThan(o.x);
    expect(s.x).toBeGreaterThanOrEqual(b.x);
    expect(o.x + o.width).toBeLessThanOrEqual(b.x + b.width + 1);
    expect(s.height).toBeGreaterThanOrEqual(44);
    expect(o.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Other devices' })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('button', { name: 'Sign out', exact: true }), 'no bottom bar').toHaveCount(1);
    await expectNoPageOverflow(page);
  });

  test('at 900 the two Sessions buttons share a row', async ({ page }) => {
    await page.setViewportSize(BELOW_LG);
    const { profile, card, signOut, others } = await account(page);
    const a = await box(profile);
    const b = await box(card);
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
    expect(Math.abs((await box(signOut)).y - (await box(others)).y)).toBeLessThanOrEqual(1);
    await expectNoPageOverflow(page);
  });

  test('at 360 the Sessions buttons stack at full width, Sign out first, no overflow', async ({ page }) => {
    await page.setViewportSize(PHONE);
    const { profile, card, signOut, others } = await account(page);
    const a = await box(profile);
    const b = await box(card);
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height - 1);
    const s = await box(signOut);
    const o = await box(others);
    expect(o.y, 'stacked, Sign out first').toBeGreaterThanOrEqual(s.y + s.height - 1);
    expect(Math.abs(s.x - o.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.width - o.width)).toBeLessThanOrEqual(1);
    expect(s.width, 'full width of the card content').toBeGreaterThan(b.width - 60);
    expect(s.height).toBeGreaterThanOrEqual(44);
    expect(o.height).toBeGreaterThanOrEqual(44);
    await expectNoPageOverflow(page);
  });

  test('Arabic: still two columns at lg+, mirrored, no overflow', async ({ page, context }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
    await setRole(page, 'OWNER', DASHBOARD);
    await mockSetupApi(page);
    await page.setViewportSize(WIDE);
    await page.goto('/app/account');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const sections = page.getByRole('main').locator('section');
    await expect(sections).toHaveCount(2);
    const first = await box(sections.nth(0));
    const second = await box(sections.nth(1));
    expect(second.x + second.width, 'RTL: the second card is to the left of the first').toBeLessThanOrEqual(first.x + 1);
    await expectNoPageOverflow(page);
  });
});

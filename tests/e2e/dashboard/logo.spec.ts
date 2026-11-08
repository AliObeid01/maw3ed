import sharp from 'sharp';
import type { Page, Route } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { expectNoPageOverflow } from '../helpers/layout';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';

// PR-10b: the logo section in Settings > Business. Every /api call is answered by page.route; the stored
// image is a tiny generated WebP. No real business, person or photo is involved.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

const LOGO_URL = '/api/public/studio-nour/logo?v=0123456789abcdef';

const png = (w: number, h: number, color = '#2f6fdd') =>
  sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
const webp = () =>
  sharp({ create: { width: 256, height: 256, channels: 3, background: '#12a37f' } }).webp().toBuffer();

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const apiError = (route: Route, status: number, code: string) =>
  json(route, status, { error: { code, message: code, fields: {} } });

/** Settings with the generated image served for the logo url (or a 404 / 500 for it). */
async function open(
  page: Page,
  opts: {
    logoUrl?: string | null;
    image?: 'ok' | 'missing';
    put?: (route: Route) => Promise<void> | void;
    del?: (route: Route) => Promise<void> | void;
  } = {},
) {
  const state = defaultState();
  state.business.logoUrl = opts.logoUrl ?? null;
  const bodies: { put: { image: string }[]; del: number } = { put: [], del: 0 };
  const image = await webp();
  await mockSetupApi(page, {
    state,
    override: async (route, method, path, body) => {
      if (path === '/api/business/logo' && method === 'PUT') {
        bodies.put.push(body as { image: string });
        if (opts.put) await opts.put(route);
        else await json(route, 200, { logoUrl: LOGO_URL });
        return true;
      }
      if (path === '/api/business/logo' && method === 'DELETE') {
        bodies.del++;
        if (opts.del) await opts.del(route);
        else await route.fulfill({ status: 204 });
        return true;
      }
      return false;
    },
  });
  await page.route('**/api/public/*/logo*', (route) =>
    opts.image === 'missing'
      ? apiError(route, 404, 'NOT_FOUND')
      : route.fulfill({ status: 200, contentType: 'image/webp', body: image }),
  );
  await setRole(page, 'OWNER', DASHBOARD);
  await page.goto('/app/settings');
  await expect(page.getByLabel('Name')).toHaveValue('Studio Nour');
  return bodies;
}

const section = (page: Page) => page.getByRole('group', { name: 'Logo' });
const pick = (page: Page, file: { name: string; mimeType: string; buffer: Buffer }) =>
  page.getByLabel('Choose a logo image').setInputFiles(file);
const upload = async (page: Page, w = 1200, h = 800) =>
  pick(page, { name: 'logo.png', mimeType: 'image/png', buffer: await png(w, h) });

test.describe('Settings: logo', () => {
  test('empty state shows the initials and the upload button', async ({ page }) => {
    await open(page);
    await expect(section(page).getByRole('img', { name: 'Studio Nour' })).toHaveText('SN');
    await expect(section(page).getByRole('button', { name: 'Upload logo' })).toBeVisible();
    await expect(section(page).getByRole('button', { name: 'Remove logo' })).toHaveCount(0);
    await expect(section(page)).toContainText('No logo yet');
  });

  test('upload: preview with a crop hint, Cancel discards, Save sends a downscaled square and shows the logo', async ({
    page,
  }) => {
    const bodies = await open(page);
    await upload(page);
    const preview = section(page).getByRole('img', { name: 'Studio Nour' });
    await expect(preview).toBeVisible();
    await expect(section(page)).toContainText('we keep the centre of your picture');
    expect(bodies.put).toHaveLength(0);

    // Cancel: back to the initials, nothing sent.
    await section(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(section(page).getByRole('img', { name: 'Studio Nour' })).toHaveText('SN');
    expect(bodies.put).toHaveLength(0);

    await upload(page);
    await section(page).getByRole('button', { name: 'Save logo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Logo saved' })).toBeVisible();
    expect(bodies.put).toHaveLength(1);
    const sent = Buffer.from(bodies.put[0]!.image, 'base64');
    const meta = await sharp(sent).metadata();
    expect([meta.width, meta.height]).toEqual([512, 512]); // 1200x800 -> centre square 800 -> at most 512
    expect(bodies.put[0]!.image.startsWith('data:')).toBe(false);
    // The saved logo is shown, with the change and remove actions.
    await expect(section(page).locator('img')).toHaveAttribute('src', LOGO_URL);
    await expect(section(page).getByRole('button', { name: 'Change logo' })).toBeVisible();
    await expect(section(page).getByRole('button', { name: 'Remove logo' })).toBeVisible();
  });

  test('the sidebar chip shows the new logo without a reload (desktop sidebar)', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'the business chip is in the desktop sidebar');
    await open(page);
    await expect(page.locator('aside img')).toHaveCount(0);
    await upload(page);
    await section(page).getByRole('button', { name: 'Save logo' }).click();
    await expect(page.locator('aside img')).toHaveAttribute('src', LOGO_URL);
  });

  test('remove asks first, then deletes and goes back to the initials', async ({ page }) => {
    const bodies = await open(page, { logoUrl: LOGO_URL });
    await expect(section(page).locator('img')).toHaveAttribute('src', LOGO_URL);
    await section(page).getByRole('button', { name: 'Remove logo' }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove your logo?' });
    await expect(dialog).toContainText('will show your initials');
    // Keep: nothing happens.
    await dialog.getByRole('button', { name: 'Keep logo' }).click();
    expect(bodies.del).toBe(0);
    await section(page).getByRole('button', { name: 'Remove logo' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove logo' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Logo removed' })).toBeVisible();
    expect(bodies.del).toBe(1);
    await expect(section(page).getByRole('img', { name: 'Studio Nour' })).toHaveText('SN');
  });

  test('falls back to the initials when the stored image fails to load', async ({ page }) => {
    await open(page, { logoUrl: LOGO_URL, image: 'missing' });
    await expect(section(page).locator('img')).toHaveCount(0);
    await expect(section(page).getByRole('img', { name: 'Studio Nour' })).toHaveText('SN');
  });

  test('client-side checks: a GIF is refused before anything is sent, a file over 3 MB too', async ({
    page,
  }) => {
    const bodies = await open(page);
    await pick(page, { name: 'logo.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(section(page).getByRole('alert')).toContainText('That file type is not supported');
    await pick(page, {
      name: 'big.png',
      mimeType: 'image/png',
      buffer: Buffer.concat([await png(10, 10), Buffer.alloc(3 * 1024 * 1024)]),
    });
    await expect(section(page).getByRole('alert')).toContainText('larger than 3 MB');
    // A file the browser cannot decode (declared as a PNG): "could not read".
    await pick(page, { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(section(page).getByRole('alert')).toContainText('could not read that image');
    expect(bodies.put).toHaveLength(0);
  });

  const failures: [string, number, string, RegExp][] = [
    ['UNSUPPORTED_IMAGE', 400, 'UNSUPPORTED_IMAGE', /file type is not supported/],
    ['INVALID_IMAGE', 400, 'INVALID_IMAGE', /could not read that image/],
    ['IMAGE_TOO_LARGE', 400, 'IMAGE_TOO_LARGE', /larger than 3 MB/],
    ['payload too large', 413, 'PAYLOAD_TOO_LARGE', /larger than 3 MB/],
    ['rate limited', 429, 'RATE_LIMITED', /uploaded a lot of images/],
    ['forbidden', 403, 'FORBIDDEN', /Only the owner can change the logo/],
    ['server error', 500, 'INTERNAL', /could not save the logo/],
  ];
  for (const [name, status, code, text] of failures)
    test(`server error: ${name} shows its own message and keeps the preview`, async ({ page }) => {
      await open(page, { put: (route) => apiError(route, status, code) });
      await upload(page);
      await section(page).getByRole('button', { name: 'Save logo' }).click();
      await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
      await expect(section(page).getByRole('button', { name: 'Save logo' })).toBeEnabled();
    });

  test('shows a loading state while saving (button busy, cancel disabled)', async ({ page }) => {
    await open(page, {
      put: async (route) => {
        await new Promise((r) => setTimeout(r, 600));
        await json(route, 200, { logoUrl: LOGO_URL });
      },
    });
    await upload(page);
    await section(page).getByRole('button', { name: 'Save logo' }).click();
    await expect(section(page).getByRole('button', { name: 'Saving…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await expect(section(page).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(page.getByRole('status').filter({ hasText: 'Logo saved' })).toBeVisible();
  });

  test('tap targets are at least 44 px', async ({ page }) => {
    await open(page, { logoUrl: LOGO_URL });
    for (const name of ['Change logo', 'Remove logo']) {
      const box = await section(page).getByRole('button', { name }).boundingBox();
      expect(box!.height, name).toBeGreaterThanOrEqual(44);
    }
  });

  for (const [label, width, height] of [
    ['360', 360, 800],
    ['1440', 1440, 900],
  ] as const)
    test(`no horizontal overflow at ${label} px (empty, preview, saved, error)`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page, { put: (route) => apiError(route, 429, 'RATE_LIMITED') });
      await expectNoPageOverflow(page);
      await upload(page);
      await expectNoPageOverflow(page);
      await section(page).getByRole('button', { name: 'Save logo' }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'uploaded a lot' })).toBeVisible();
      await expectNoPageOverflow(page);
    });

  for (const [label, width, height] of [
    ['360', 360, 800],
    ['1440', 1440, 900],
  ] as const)
    test(`Arabic RTL at ${label} px: strings, direction, no overflow`, async ({ page, context }) => {
      await context.addCookies([{ name: 'locale', value: 'ar', url: DASHBOARD }]);
      await page.setViewportSize({ width, height });
      const state = defaultState();
      state.business.logoUrl = LOGO_URL;
      await mockSetupApi(page, { state });
      await page.route('**/api/public/*/logo*', async (route) =>
        route.fulfill({ status: 200, contentType: 'image/webp', body: await webp() }),
      );
      await setRole(page, 'OWNER', DASHBOARD);
      await page.goto('/app/settings');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const group = page.getByRole('group', { name: 'الشعار' });
      await expect(group).toBeVisible();
      await expect(group.getByRole('button', { name: 'تغيير الشعار' })).toBeVisible();
      await expect(group.getByRole('button', { name: 'إزالة الشعار' })).toBeVisible();
      await group.getByLabel('اختر صورة الشعار').setInputFiles({
        name: 'logo.png',
        mimeType: 'image/png',
        buffer: await png(900, 600),
      });
      await expect(group).toContainText('نحتفظ بوسط صورتك');
      await expect(group.getByRole('button', { name: 'حفظ الشعار' })).toBeVisible();
      await expectNoPageOverflow(page);
    });
});

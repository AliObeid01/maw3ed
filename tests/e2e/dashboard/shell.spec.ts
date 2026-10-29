import { expect, test } from '@playwright/test';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';

const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

const ownerOnlyPages = ['services', 'staff', 'hours', 'settings', 'share', 'setup'];

test.describe('receptionist (STAFF)', () => {
  for (const name of ownerOnlyPages) {
    test(`/app/${name} shows the friendly owner-only state and makes no setup API call`, async ({
      page,
    }) => {
      await setRole(page, 'STAFF', DASHBOARD);
      const { calls } = await mockSetupApi(page);
      await page.goto(`/app/${name}`);
      await expect(
        page.getByRole('heading', { name: 'Only the owner can change this' }),
      ).toBeVisible();
      expect(calls).toEqual([]);
    });
  }

  test('the Business navigation is hidden', async ({ page, isMobile }) => {
    await setRole(page, 'STAFF', DASHBOARD);
    await mockSetupApi(page);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening), Lina/ })).toBeVisible();
    if (isMobile) {
      await page.getByRole('button', { name: 'More' }).click();
      await expect(
        page.getByRole('dialog').getByRole('link', { name: 'Pilot report' }),
      ).toBeVisible();
      await expect(page.getByRole('dialog').getByRole('link', { name: 'Services' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('link', { name: 'Pilot report' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Services' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Booking link' })).toHaveCount(0);
    }
  });
});

test.describe('owner', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
  });

  test('an API 403 on an owner page shows the same friendly state', async ({ page }) => {
    await mockSetupApi(page, { forceStatus: 403 });
    await page.goto('/app/services');
    await expect(
      page.getByRole('heading', { name: 'Only the owner can change this' }),
    ).toBeVisible();
    await expect(page.getByText('FORBIDDEN')).toHaveCount(0);
  });

  test('marks the current page in the navigation with aria-current', async ({ page, isMobile }) => {
    await mockSetupApi(page);
    await page.goto('/app/services');
    if (isMobile) {
      await page.getByRole('button', { name: 'More' }).click();
      await expect(
        page.getByRole('dialog').getByRole('link', { name: 'Services' }),
      ).toHaveAttribute('aria-current', 'page');
    } else {
      await expect(page.getByRole('link', { name: 'Services' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByRole('link', { name: 'Setup' })).not.toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  test('shows the real business name and user in the shell', async ({ page, isMobile }) => {
    await mockSetupApi(page);
    await page.goto('/app/setup');
    if (!isMobile) {
      await expect(page.getByText('Studio Nour').first()).toBeVisible();
      await expect(page.getByText('Lina · Owner')).toBeVisible();
    }
    await expect(page.getByText('Welcome, Lina')).toBeVisible();
  });

  test('signing out calls the logout API and returns to the login page', async ({
    page,
    isMobile,
  }) => {
    const { calls } = await mockSetupApi(page);
    await page.goto('/app');
    if (isMobile) {
      await page.getByRole('button', { name: 'More' }).click();
      await page.getByRole('button', { name: 'Sign out' }).click();
    } else {
      await page.getByRole('button', { name: 'Account' }).click();
      await page.getByRole('button', { name: 'Sign out' }).click();
    }
    await page.waitForURL('**/login');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/auth/logout')).toBe(true);
  });

  test('unknown business routes do not break the shell (not-yet-built pages 404 inside it)', async ({
    page,
  }) => {
    await mockSetupApi(page, { state: defaultState() });
    const response = await page.goto('/app/reminders');
    expect(response?.status()).toBe(404);
  });
});

test.describe('3.9 share link', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'OWNER', DASHBOARD);
  });

  test('copies the public booking link to the clipboard and confirms', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: DASHBOARD });
    await mockSetupApi(page);
    await page.goto('/app/share');
    await expect(page.getByText(`/b/studio-nour`).first()).toBeVisible();
    await page.getByRole('button', { name: 'Copy link' }).first().click();
    await expect(page.getByRole('status')).toContainText('Booking link copied');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toBe(`${DASHBOARD}/b/studio-nour`);
  });

  test('falls back to a hidden textarea when the Clipboard API is unavailable', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      const copied: string[] = [];
      (window as unknown as { __copied: string[] }).__copied = copied;
      document.execCommand = (command: string) => {
        if (command !== 'copy') return false;
        copied.push((document.activeElement as HTMLTextAreaElement | null)?.value ?? '');
        return true;
      };
    });
    await mockSetupApi(page);
    await page.goto('/app/share');
    await page.getByRole('button', { name: 'Copy link' }).first().click();
    await expect(page.getByRole('status')).toContainText('Booking link copied');
    const copied = await page.evaluate(
      () => (window as unknown as { __copied: string[] }).__copied,
    );
    expect(copied).toEqual([`${DASHBOARD}/b/studio-nour`]);
  });

  test('offers a WhatsApp share link with the encoded booking URL and a QR code', async ({
    page,
  }) => {
    await mockSetupApi(page);
    await page.goto('/app/share');
    const whatsapp = page.getByRole('link', { name: /WhatsApp status/ });
    const href = (await whatsapp.getAttribute('href'))!;
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(href.split('text=')[1]!)).toContain(`${DASHBOARD}/b/studio-nour`);
    await expect(whatsapp).toHaveAttribute('target', '_blank');
    await expect(whatsapp).toHaveAttribute('rel', /noopener/);
    const qr = page.getByRole('img', {
      name: /QR code that opens the booking page of Studio Nour/,
    });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);
  });

  test('says when bookings are not ready yet and links to setup', async ({ page }) => {
    await mockSetupApi(page);
    await page.goto('/app/share');
    await expect(page.getByText('Not ready for bookings yet')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Finish setup' })).toHaveAttribute(
      'href',
      '/app/setup',
    );
  });

  test('says it is live once services, a bookable person and hours exist', async ({ page }) => {
    const state = defaultState();
    state.business.setup = { hasServices: true, hasBookableStaff: true, hasHours: true };
    await mockSetupApi(page, { state });
    await page.goto('/app/share');
    await expect(page.getByText('Live and taking bookings')).toBeVisible();
  });
});

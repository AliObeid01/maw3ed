import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';
import { blockStorage, readStored, saved, seedBookings, seedRaw, STORAGE_KEY } from './helpers/myBookings';
import { mockLinkApi, type LinkMock } from './helpers/publicMock';

// PR-16 item 1: "Save to My bookings on this device" on the confirm / cancel link page (/l/<token>).
// Self-contained: every /api/links call is answered by page.route on the frozen clock.

const TOKEN = 'view-token-0001';

const COPY = {
  en: {
    button: 'Save to My bookings on this device',
    done: 'Saved on this device',
    link: 'View My bookings',
    upcoming: 'Upcoming',
  },
  ar: {
    button: 'احفظ الحجز في «حجوزاتي» على هذا الجهاز',
    done: 'تم الحفظ على هذا الجهاز',
    link: 'عرض حجوزاتي',
    upcoming: 'القادمة',
  },
} as const;

for (const lang of ['en', 'ar'] as const) {
  const c = COPY[lang];
  test.describe(`save from the link page (${lang})`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: 'locale', value: lang, url: baseURL! }]);
    });

    async function open(page: Parameters<typeof mockLinkApi>[0], mock: LinkMock = { act: 'view' }, token = TOKEN) {
      const api = await mockLinkApi(page, mock);
      await page.goto(`/l/${token}`);
      return api;
    }

    test('one tap saves the booking; it shows under Upcoming in My bookings; the quiet state survives a reload', async ({
      page,
    }) => {
      await open(page);
      const button = page.getByRole('button', { name: c.button });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await expectNoPageOverflow(page);

      await button.click();
      await expect(page.getByText(c.done)).toBeVisible();
      await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);
      const raw = JSON.parse((await readStored(page))!);
      expect(raw.entries).toHaveLength(1);
      expect(raw.entries[0]).toMatchObject({
        token: TOKEN,
        slug: 'studio-nour',
        serviceName: 'Haircut',
        staffName: 'Karim',
        timezone: 'Asia/Beirut',
      });
      // Privacy: nothing about the client, ever.
      expect(Object.keys(raw.entries[0]).sort()).toEqual(
        ['businessName', 'endAt', 'reference', 'savedAt', 'serviceName', 'slug', 'staffName', 'startAt', 'timezone', 'token'].sort(),
      );

      // Reload: the quiet state, not the button.
      await page.reload();
      await expect(page.getByText(c.done)).toBeVisible();
      await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);

      await page.getByRole('link', { name: c.link }).click();
      await expect(page).toHaveURL(/\/my-bookings$/);
      const section = page.getByRole('region', { name: c.upcoming }).or(page.getByRole('heading', { name: c.upcoming }));
      await expect(section.first()).toBeVisible();
      await expect(page.getByTestId('upcoming-card')).toHaveCount(1);
      await expect(page.getByTestId('upcoming-card')).toContainText('Haircut');
    });

    test('already saved: only the quiet state', async ({ page }) => {
      await seedBookings(page, [saved({ token: TOKEN })]);
      await open(page);
      await expect(page.getByText(c.done)).toBeVisible();
      await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);
    });

    test('a cancelled booking offers nothing', async ({ page }) => {
      await open(page, { act: 'view', status: 'CANCELLED' });
      await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);
      await expect(page.getByText(c.done)).toHaveCount(0);
    });

    test('a past booking offers nothing', async ({ page }) => {
      await open(page, { act: 'view', status: 'ATTENDED' });
      await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);
    });

    test('a confirm link (not a view link) offers nothing', async ({ page }) => {
      await open(page, { act: 'confirm' });
      await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);
    });

    test('blocked storage: no button, no error', async ({ page }) => {
      await blockStorage(page);
      await open(page);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByRole('button', { name: c.button })).toHaveCount(0);
      await expect(page.getByText(c.done)).toHaveCount(0);
      await expect(page.locator('main [role="alert"]')).toHaveCount(0);
    });
  });
}

test('a hostile token in the URL never reaches the store', async ({ page }) => {
  await seedRaw(page, JSON.stringify({ v: 1, entries: [] }));
  // The mock answers any token; the validator refuses to store one that is not a signed-token shape.
  await open(page, { act: 'view' }, 'a%20b%3Cscript%3E');
  await expect(page.getByRole('button', { name: COPY.en.button })).toHaveCount(0);
  expect(JSON.parse((await readStored(page)) ?? '{"entries":[]}').entries).toHaveLength(0);
  void STORAGE_KEY;

  async function open(p: typeof page, mock: LinkMock, token: string) {
    await mockLinkApi(p, mock);
    await p.goto(`/l/${token}`);
  }
});

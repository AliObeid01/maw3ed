import { expect, test } from '../helpers/test';
import { expectNoPageOverflow } from '../helpers/layout';
import { defaultState, mockSetupApi, setRole } from '../helpers/mockApi';

// PR-15b: the "Let clients book from Claude" card on the Booking link page. The dashboard dev server runs with
// MCP_ENABLED=true (playwright.config.ts). The switched-off behaviour (the page passes isAssistantEnabled() down) is
// proven in tests/unit/mcp/entryGating.test.ts. Every /api call is answered by page.route (helpers/mockApi.ts).
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });

const LANGS = [
  {
    lang: 'en',
    title: 'Let clients book from Claude',
    message: `You can also book me by chatting with Claude: open ${DASHBOARD}/assistant and add the link, then ask Claude to book at "Studio Nour". My booking page: ${DASHBOARD}/b/studio-nour`,
    unlisted: 'Claude can only find listed businesses. List your business to let clients book from Claude.',
    listLink: 'Go to the listing switch',
    whatsapp: 'Send on WhatsApp',
    copied: 'Message copied',
  },
  {
    lang: 'ar',
    title: 'دع عملاءك يحجزون من Claude',
    message: `يمكنك أيضًا الحجز عندي بالمحادثة مع Claude: افتح ${DASHBOARD}/assistant وأضف الرابط، ثم اطلب من Claude الحجز في "Studio Nour". صفحة الحجز: ${DASHBOARD}/b/studio-nour`,
    unlisted: 'Claude لا يجد إلا الأنشطة المدرجة. أدرج نشاطك ليحجز العملاء منه عبر Claude.',
    listLink: 'اذهب إلى مفتاح الإدراج',
    whatsapp: 'أرسل عبر واتساب',
    copied: 'تم نسخ الرسالة',
  },
] as const;

for (const L of LANGS) {
  test.describe(`Share page: Claude card (${L.lang})`, () => {
    test.beforeEach(async ({ page, context }) => {
      await setRole(page, 'OWNER', DASHBOARD);
      await context.addCookies([{ name: 'locale', value: L.lang, url: DASHBOARD }]);
    });

    test('listed: message, copy, WhatsApp link and a QR code for /assistant', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const state = defaultState();
      state.business.listed = true;
      await mockSetupApi(page, { state });
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/app/share');
        const card = page.getByTestId('claude-share');
        await expect(card.getByRole('heading', { name: L.title })).toBeVisible();
        await expect(card.getByTestId('claude-share-message')).toHaveValue(L.message);
        const wa = card.getByTestId('claude-share-whatsapp');
        await expect(wa).toHaveText(new RegExp(L.whatsapp));
        const href = (await wa.getAttribute('href'))!;
        expect(href.startsWith('https://wa.me/?text=')).toBe(true);
        expect(decodeURIComponent(href.slice('https://wa.me/?text='.length))).toBe(L.message);
        await expect(wa).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(card.locator('img[src^="data:image/png"]')).toBeVisible();
        for (const id of ['claude-share-copy', 'claude-share-whatsapp']) {
          expect((await card.getByTestId(id).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await expect(card.getByTestId('claude-share-list-link')).toHaveCount(0);
        await expectNoPageOverflow(page);
      }
      await page.getByTestId('claude-share-copy').click();
      await expect(page.getByRole('status').filter({ hasText: L.copied }).first()).toBeAttached();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(L.message);
    });

    test('unlisted: a quiet note and a link to the listing card, no message, no QR', async ({ page }) => {
      await mockSetupApi(page, { state: defaultState() });
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/app/share');
        const card = page.getByTestId('claude-share');
        await expect(card.getByRole('heading', { name: L.title })).toBeVisible();
        await expect(card.getByText(L.unlisted)).toBeVisible();
        const link = card.getByTestId('claude-share-list-link');
        await expect(link).toHaveText(L.listLink);
        await expect(link).toHaveAttribute('href', '#directory');
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await expect(card.getByTestId('claude-share-message')).toHaveCount(0);
        await expect(card.getByTestId('claude-share-whatsapp')).toHaveCount(0);
        await expect(card.locator('img')).toHaveCount(0);
        await expect(page.locator('#directory')).toBeVisible();
        await expectNoPageOverflow(page);
      }
    });
  });
}

// PR-16 (4b): the same server answers as a server WITHOUT MCP_ENABLED when the test-only cookie `e2e_mcp=off` is
// sent (src/app/app/share/page.tsx honours it only under E2E_FAKE_SESSION=1). The card is absent, for a listed
// and an unlisted business, and the ordinary booking-link QR code is unchanged.
for (const L of LANGS) {
  test.describe(`Share page: connector switched off (${L.lang})`, () => {
    test.beforeEach(async ({ page, context }) => {
      await setRole(page, 'OWNER', DASHBOARD);
      await context.addCookies([
        { name: 'locale', value: L.lang, url: DASHBOARD },
        { name: 'e2e_mcp', value: 'off', url: DASHBOARD },
      ]);
    });

    for (const listed of [true, false]) {
      test(`no Claude card (${listed ? 'listed' : 'unlisted'}); the booking-link QR code is unchanged`, async ({ page }) => {
        const state = defaultState();
        state.business.listed = listed;
        await mockSetupApi(page, { state });
        for (const width of [360, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto('/app/share');
          await expect(page.getByTestId('claude-share')).toHaveCount(0);
          await expect(page.getByText(L.title)).toHaveCount(0);
          await expect(page.getByTestId('claude-share-message')).toHaveCount(0);
          // The ordinary booking link QR code (QrCard) is still there.
          const qr = page.locator('img[src^="data:image/png;base64,"]');
          await expect(qr).toHaveCount(1);
          await expect(qr).toBeVisible();
          await expectNoPageOverflow(page);
        }
      });
    }
  });
}

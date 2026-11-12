import { type Page } from '@playwright/test';
import { expect, test } from '../helpers/test';
import { expectNoPageOverflow } from '../helpers/layout';
import { defaultState, mockSetupApi, setRole, type MockOptions } from '../helpers/mockApi';

// Owner setup assistant (MCP idea 4), frontend: the "Set up with Claude" card on Setup, "Connected apps" in Settings and
// the /for-business teaser. The dashboard dev server runs with MCP_OWNER_ENABLED=true (playwright.config.ts); the cookie
// `e2e_mcp_owner=off` makes it answer as a server without the flag. Every /api call is answered by page.route.
const DASHBOARD = `http://localhost:${process.env.DASHBOARD_PORT ?? 3100}`;
test.skip(!!process.env.BASE_URL, 'needs the fake-session dev server');
test.use({ baseURL: DASHBOARD });
test.setTimeout(90_000);

type Grant = { id: string; clientName: string; createdAt: string; lastUsedAt: string | null };
const GRANT: Grant = { id: 'g1abcdefghij', clientName: 'Claude', createdAt: '2026-11-01T10:00:00.000Z', lastUsedAt: '2026-11-10T08:30:00.000Z' };

function grantsOverride(grants: Grant[], opts: { revoke?: 'ok' | '404' | '500'; list?: 'ok' | '500' } = {}): MockOptions['override'] {
  return async (route, method, path) => {
    if (path === '/api/oauth/grants' && method === 'GET') {
      if (opts.list === '500') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ grants }) });
      }
      return true;
    }
    const m = /^\/api\/oauth\/grants\/([^/]+)\/revoke$/.exec(path);
    if (m && method === 'POST') {
      if (opts.revoke === '500') await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) });
      else if (opts.revoke === '404') await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }) });
      else {
        const i = grants.findIndex((g) => g.id === m[1]);
        if (i >= 0) grants.splice(i, 1);
        await route.fulfill({ status: 204 });
      }
      return true;
    }
    return false;
  };
}

async function setup(page: Page, lang: 'en' | 'ar', grants: Grant[], extra: { off?: boolean; role?: 'OWNER' | 'STAFF' } = {}, opts = {}) {
  await setRole(page, extra.role ?? 'OWNER', DASHBOARD);
  const cookies: { name: string; value: string; url: string }[] = [{ name: 'locale', value: lang, url: DASHBOARD }];
  if (extra.off) cookies.push({ name: 'e2e_mcp_owner', value: 'off', url: DASHBOARD });
  await page.context().addCookies(cookies);
  return mockSetupApi(page, { state: defaultState(), override: grantsOverride(grants, opts) });
}

const L = {
  en: {
    title: 'Set up with Claude',
    copied: 'Copied',
    steps: ['In Claude open Customize', 'Sign in to Maw3ed and tap Allow', 'Tell Claude about your business'],
    prompts: ['Set up my barbershop', 'What is still missing in my setup?', 'Set 15-minute slots'],
    plan: 'The Free plan has one bookable person; a second staff member needs Pro.',
    connected: 'Claude is connected',
    apps: 'Connected apps',
    empty: 'No apps connected',
    on: 'Connected Nov 1, 2026',
    used: 'Last used Nov 10, 2026',
    teaser: 'Prefer to talk?',
    checkFailed: 'Claude connection: we could not check right now.',
    retry: 'Retry',
  },
  ar: {
    title: 'الإعداد مع Claude',
    copied: 'تم النسخ',
    steps: ['في Claude افتح Customize', 'سجّل الدخول إلى موعد', 'أخبر Claude عن نشاطك'],
    prompts: ['جهّز صالون الحلاقة', 'ما الذي ما زال ناقصًا', 'اجعل المواعيد كل 15 دقيقة'],
    plan: 'الخطة المجانية تتسع لشخص واحد',
    connected: 'Claude متصل',
    apps: 'التطبيقات المتصلة',
    empty: 'لا توجد تطبيقات متصلة',
    on: 'تم الربط في 1 نوفمبر 2026',
    used: 'آخر استخدام 10 نوفمبر 2026',
    teaser: 'تفضّل الحديث؟',
    checkFailed: 'اتصال Claude: تعذّر التحقق الآن.',
    retry: 'إعادة المحاولة',
  },
} as const;

for (const lang of ['en', 'ar'] as const) {
  const T = L[lang];
  test.describe(`Owner connector (${lang})`, () => {
    test('Setup: the card, copy with announcement, steps, prompts, no overflow at 360 and 1440', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await setup(page, lang, []);
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/app/setup');
        const card = page.getByTestId('owner-connector');
        await expect(card.getByRole('heading', { level: 2, name: T.title })).toBeVisible();
        if (lang === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        const url = card.getByTestId('connector-url');
        const value = await url.inputValue();
        expect(value.endsWith('/api/mcp/owner')).toBe(true);
        expect(value.startsWith('http')).toBe(true);
        for (const s of T.steps) await expect(card.getByText(s, { exact: false })).toBeVisible();
        for (const p of T.prompts) await expect(card.getByText(p, { exact: false }).first()).toBeVisible();
        await expect(card.getByText(T.plan)).toBeVisible();
        await expect(card.getByRole('link').last()).toHaveAttribute('href', '/app/settings#connected-apps');
        for (const target of [card.getByTestId('connector-copy'), ...(await card.getByRole('button').all()), card.getByRole('link').last()]) {
          expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        }
        await expectNoPageOverflow(page);
        // The card is the first thing under the welcome banner: above the step list.
        const cardTop = (await card.boundingBox())!.y;
        const listTop = (await page.getByRole('list').filter({ has: page.getByRole('link', { name: /.+/ }) }).last().boundingBox())!.y;
        expect(cardTop).toBeLessThan(listTop);
      }
      await page.getByTestId('connector-copy').click();
      await expect(page.getByTestId('connector-copy-status')).toHaveText(T.copied);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/api\/mcp\/owner$/);
      await page.getByTestId('connector-prompt-prompt2').click();
      await expect(page.getByTestId('connector-copy-status')).toHaveText(T.copied);
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(T.prompts[1]);
    });

    test('Setup: a live connection collapses the card to a "connected" row', async ({ page }) => {
      await setup(page, lang, [GRANT]);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto('/app/setup');
      const row = page.getByTestId('owner-connector-connected');
      await expect(row.getByRole('heading', { name: T.connected })).toBeVisible();
      await expect(page.getByTestId('owner-connector')).toHaveCount(0);
      await expect(page.getByTestId('connector-url')).toHaveCount(0);
      await expectNoPageOverflow(page);
    });

    test('Settings: lists the connection, confirms inside the page, revokes optimistically', async ({ page }) => {
      const grants = [GRANT];
      await setup(page, lang, grants);
      for (const width of [360, 1440]) {
        if (width === 1440) grants.splice(0, grants.length, GRANT);
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/app/settings');
        const card = page.getByTestId('connected-apps');
        await expect(card.getByRole('heading', { name: T.apps })).toBeVisible();
        const row = card.getByTestId('connected-app');
        await expect(row).toContainText('Claude');
        await expect(row).toContainText(T.on);
        await expect(row).toContainText(T.used);
        await expectNoPageOverflow(page);
        await row.getByRole('button').click();
        await expect(row.getByRole('group')).toBeVisible();
        for (const b of await row.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        await expectNoPageOverflow(page);
        await row.getByRole('button').first().click();
        await expect(card.getByTestId('connected-app')).toHaveCount(0);
        await expect(card.getByTestId('connected-apps-empty')).toContainText(T.empty);
        await expect(card.getByTestId('connector-url')).toBeVisible();
        await expectNoPageOverflow(page);
      }
    });

    test('Settings: a failed revoke puts the row back with an error; a 404 just removes it', async ({ page }) => {
      await setup(page, lang, [GRANT], {}, { revoke: '500' });
      await page.goto('/app/settings');
      const card = page.getByTestId('connected-apps');
      await card.getByTestId('connected-app').getByRole('button').click();
      await card.getByTestId('connected-app').getByRole('button').first().click();
      await expect(card.getByRole('alert')).toBeVisible();
      await expect(card.getByTestId('connected-app')).toHaveCount(1);
    });

    test('Settings: a 404 on revoke means it is already gone', async ({ page }) => {
      await setup(page, lang, [GRANT], {}, { revoke: '404' });
      await page.goto('/app/settings');
      const card = page.getByTestId('connected-apps');
      await card.getByTestId('connected-app').getByRole('button').click();
      await card.getByTestId('connected-app').getByRole('button').first().click();
      await expect(card.getByTestId('connected-app')).toHaveCount(0);
      await expect(card.getByRole('alert')).toHaveCount(0);
    });

    test('Settings: a load error shows the retry state', async ({ page }) => {
      await setup(page, lang, [], {}, { list: '500' });
      await page.goto('/app/settings');
      await expect(page.getByTestId('connected-apps').getByRole('alert')).toBeVisible();
    });

    test('flag off: no card on Setup, none on Settings, nothing on /assistant; staff never see Settings', async ({ page }) => {
      await setup(page, lang, [], { off: true });
      await page.goto('/app/setup');
      await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
      await expect(page.getByTestId('owner-connector')).toHaveCount(0);
      await expect(page.getByText(T.title)).toHaveCount(0);
      await page.goto('/app/settings');
      await expect(page.getByRole('heading', { name: /./ }).first()).toBeVisible();
      await expect(page.getByTestId('connected-apps')).toHaveCount(0);
      await page.goto('/for-business');
      await expect(page.getByTestId('claude-setup-teaser')).toHaveCount(0);
    });

    test('/assistant stays client-only: no owner connector there even with the flag on', async ({ page }) => {
      await setup(page, lang, []);
      await page.goto('/assistant');
      const html = await page.content();
      expect(html).not.toContain('/api/mcp/owner');
      await expect(page.getByTestId('owner-connector')).toHaveCount(0);
    });

    test('staff do not see Connected apps', async ({ page }) => {
      await setup(page, lang, [GRANT], { role: 'STAFF' });
      await page.goto('/app/settings');
      await expect(page.getByTestId('connected-apps')).toHaveCount(0);
      await expect(page.getByTestId('connected-app')).toHaveCount(0);
    });

    test('the connector URL is in the server response (HTML + RSC payload) for the owner only', async ({ page }) => {
      await setup(page, lang, [], { role: 'STAFF' });
      for (const path of ['/app/setup', '/app/settings']) {
        const staffHtml = await (await page.request.get(path)).text();
        expect(staffHtml.length).toBeGreaterThan(1000);
        expect(staffHtml).not.toContain('/api/mcp/owner');
        // The RSC flight payload a soft navigation fetches.
        const staffRsc = await (await page.request.get(path, { headers: { RSC: '1' } })).text();
        expect(staffRsc).not.toContain('/api/mcp/owner');
      }
      await setRole(page, 'OWNER', DASHBOARD);
      for (const path of ['/app/setup', '/app/settings']) {
        expect(await (await page.request.get(path)).text()).toContain('/api/mcp/owner');
      }
    });

    test('Setup: when the connection check fails, a compact "could not check" row with Retry, not the full card', async ({ page }) => {
      const grants: Grant[] = [GRANT];
      let fail = true;
      await setRole(page, 'OWNER', DASHBOARD);
      await page.context().addCookies([{ name: 'locale', value: lang, url: DASHBOARD }]);
      await mockSetupApi(page, {
        state: defaultState(),
        override: async (route, method, path) => {
          if (path === '/api/oauth/grants' && method === 'GET') {
            if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }) });
            else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ grants }) });
            return true;
          }
          return false;
        },
      });
      for (const width of [360, 1440]) {
        fail = true;
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/app/setup');
        const row = page.getByTestId('owner-connector-error');
        await expect(row).toBeVisible();
        await expect(row.getByRole('status')).toHaveText(T.checkFailed);
        await expect(page.getByTestId('owner-connector')).toHaveCount(0);
        await expect(page.getByTestId('connector-url')).toHaveCount(0);
        const retry = row.getByTestId('owner-connector-retry');
        await expect(retry).toHaveText(T.retry);
        expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        await expectNoPageOverflow(page);
        fail = false;
        await retry.click();
        await expect(page.getByTestId('owner-connector-connected')).toBeVisible();
        await expect(page.getByTestId('owner-connector-error')).toHaveCount(0);
      }
    });

    test('/for-business: the teaser under the five steps, no connector link', async ({ page }) => {
      await setup(page, lang, []);
      for (const width of [360, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/for-business');
        const teaser = page.getByTestId('claude-setup-teaser');
        await expect(teaser).toBeVisible();
        await expect(teaser).toContainText(T.teaser);
        expect(await teaser.innerText()).not.toContain('/api/mcp');
        const cta = teaser.getByRole('link');
        expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
        await expectNoPageOverflow(page);
      }
    });
  });
}

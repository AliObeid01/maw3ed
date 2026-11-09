import { type Page } from '@playwright/test';
import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';
import { freezeClock, nowDate, nowMs } from './helpers/clock';
import { mockLinkApi, mockPublicApi, SLUG } from './helpers/publicMock';
import { saved, seedBookings } from './helpers/myBookings';
import { mockOfferApi } from './helpers/waitlistMock';

// PR-14 cosmetic fixes. Self-contained: every /api call is answered by page.route on the frozen clock.
//  (a) A forced-LTR numeric input (card number, expiry, CVC, phone) keeps its digits left-to-right but its text
//      sits at the END edge of the page (right in Arabic, left in English), under its label.
//  (b) A time range ("10:30 – 11:00") stays on one line, also at 320 px in Arabic.

const PAY_TOKEN = 'mock-pay-token.mock-pay-sig';
const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function mockPay(page: Page) {
  const startAt = new Date(nowMs() + 2 * 24 * 3600_000).toISOString();
  const endAt = new Date(nowMs() + 2 * 24 * 3600_000 + 30 * 60_000).toISOString();
  await page.route('**/api/pay/**', (route) =>
    route.fulfill(
      json({
        state: 'PENDING',
        appointment: {
          id: 'ckappt000000000000000000',
          startAt,
          endAt,
          status: 'PENDING_PAYMENT',
          service: { id: 'svc', name: 'Haircut', durationMin: 30, price: 15 },
          staff: { id: 'ckstaff00000000000000000', displayName: 'Rima' },
        },
        business: { name: 'Studio Nour', slug: SLUG, timezone: 'Asia/Beirut', locale: 'en', address: 'Hamra, Beirut' },
        deposit: { amount: 5, currency: 'USD' },
        holdExpiresAt: new Date(nowMs() + 15 * 60_000).toISOString(),
        now: nowDate().toISOString(),
        testMode: true,
        reminders: { h24: false, h2: false, email: true },
      }),
    ),
  );
}

const textAlign = (loc: ReturnType<Page['locator']>) => loc.evaluate((el) => getComputedStyle(el).textAlign);

for (const [lang, expected] of [
  ['en', 'start'],
  ['ar', 'right'],
] as const) {
  test.describe(`numeric inputs, ${lang}`, () => {
    test.beforeEach(async ({ context, baseURL }) => {
      await context.addCookies([{ name: 'locale', value: lang, url: baseURL! }]);
    });

    test(`card number, expiry and CVC keep dir=ltr and align ${expected === 'start' ? 'left (start)' : expected}`, async ({ page }) => {
      await freezeClock(page);
      await mockPay(page);
      await page.goto(`/pay/${PAY_TOKEN}`);
      for (const auto of ['cc-number', 'cc-exp', 'cc-csc']) {
        const input = page.locator(`input[autocomplete="${auto}"]`);
        await expect(input).toBeVisible();
        await expect(input).toHaveAttribute('dir', 'ltr');
        expect(await textAlign(input), auto).toBe(expected);
      }
    });

    test(`the booking phone input keeps dir=ltr and aligns ${expected === 'start' ? 'left (start)' : expected}`, async ({ page }) => {
      await mockPublicApi(page);
      await page.goto(`/b/${SLUG}`);
      await page.getByRole('button', { name: /Haircut/ }).click();
      await page.getByRole('button', { name: lang === 'ar' ? /أي موظف متاح/ : /Anyone available/ }).click();
      const slot = page.getByRole('radio', { name: '09:00', exact: true }).first();
      await slot.click();
      await page.getByRole('button', { name: lang === 'ar' ? 'متابعة' : 'Continue' }).click();
      const phone = page.locator('input[name="phone"]');
      await expect(phone).toBeVisible();
      await expect(phone).toHaveAttribute('dir', 'ltr');
      expect(await textAlign(phone)).toBe(expected);
    });
  });
}

test.describe('time range stays on one line', () => {
  for (const lang of ['ar', 'en'] as const) {
    test(`My bookings at 320 px, ${lang}`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: 'locale', value: lang, url: baseURL! }]);
      await page.setViewportSize({ width: 320, height: 720 });
      await freezeClock(page);
      await seedBookings(page, [
        saved(),
        saved(
          {
            token: 'tok-long',
            reference: 'LNG222',
            serviceName: 'Keratin smoothing treatment with deep conditioning and scalp massage',
          },
          3,
        ),
      ]);
      await mockLinkApi(page, { act: 'view' });
      await page.goto('/my-bookings');
      const cards = page.getByTestId('upcoming-card');
      await expect(cards).toHaveCount(2);
      // Every client rect of the "start – end" text must sit on one line.
      const lines = await page.evaluate(() => {
        const out: number[][] = [];
        for (const card of Array.from(document.querySelectorAll('[data-testid="upcoming-card"]'))) {
          const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const text = n.textContent ?? '';
            const m = /\d\d:\d\d\s*–\s*\d\d:\d\d/.exec(text);
            if (!m) continue;
            const range = document.createRange();
            range.setStart(n, m.index);
            range.setEnd(n, m.index + m[0].length);
            out.push(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
          }
        }
        return out;
      });
      expect(lines).toHaveLength(2);
      for (const tops of lines) expect(new Set(tops).size, JSON.stringify(tops)).toBe(1);
      await expectNoPageOverflow(page);
    });
  }
});

for (const lang of ['ar', 'en'] as const) {
  test(`confirm/cancel link and waitlist offer keep the time range on one line at 320 px, ${lang}`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([{ name: 'locale', value: lang, url: baseURL! }]);
    await page.setViewportSize({ width: 320, height: 720 });
    for (const open of [
      async () => {
        await mockLinkApi(page, { act: 'confirm' });
        await page.goto('/l/tok-1.sig');
      },
      async () => {
        await mockOfferApi(page);
        await page.goto('/o/tok.abc');
      },
    ]) {
      await open();
      await expect(page.locator('main')).toContainText(/\d\d:\d\d/);
      const lines = await page.evaluate(() => {
        const out: number[][] = [];
        const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const m = /\d\d:\d\d[\s\u00a0]*–[\s\u00a0\u2060]*\d\d:\d\d/.exec(n.textContent ?? '');
          if (!m) continue;
          const range = document.createRange();
          range.setStart(n, m.index);
          range.setEnd(n, m.index + m[0].length);
          out.push(Array.from(range.getClientRects()).map((r) => Math.round(r.top)));
        }
        return out;
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const tops of lines) expect(new Set(tops).size, JSON.stringify(tops)).toBe(1);
      await expectNoPageOverflow(page);
    }
  });
}

test('booked subtitle (Arabic): the time range, service and staff are bidi-isolated runs', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  await page.setViewportSize({ width: 360, height: 800 });
  await mockPublicApi(page);
  await page.goto(`/b/${SLUG}`);
  await page.getByRole('button', { name: /Haircut/ }).click();
  await page.getByRole('button', { name: /أي موظف متاح/ }).click();
  await page.getByRole('radio', { name: '09:00', exact: true }).first().click();
  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByLabel('الاسم الكامل').fill('Maya Haddad');
  await page.locator('input[name="phone"]').fill('71 234 567');
  await page.locator('input[name="email"]').fill('maya@example.test');
  await page.getByRole('button', { name: 'تأكيد الحجز' }).click();
  const heading = page.getByRole('heading', { level: 2 }).first();
  await expect(heading).toBeVisible();
  const subtitle = (await heading.locator('xpath=following-sibling::p').innerText()).replace(/[  ]+/g, ' ');
  // LRI + "09:00 – 09:30" + PDI keeps the range in reading order inside the Arabic line; names are first-strong isolates.
  expect(subtitle).toMatch(/⁦09:00[  ]–⁠[  ]09:30⁩/);
  expect(subtitle).toContain('⁨Haircut⁩');
  // PR-14b (a): the separators live in the message and are glued to the run that follows (no dangling "·" at a line end).
  const rawSubtitle = await heading.locator('xpath=following-sibling::p').innerText();
  expect.soft(rawSubtitle).toMatch(/ · ⁦09:00/);
  expect.soft(rawSubtitle).toMatch(/⁩ · ⁨Haircut/);
  // Geometry: every "·" sits on the same line as the character after it (a dot stranded at a line end reads as an error).
  // At 360 px this subtitle fits on one line, so the check runs at narrow widths where it really wraps, and the test
  // fails if it never wraps (then it would prove nothing).
  const subtitleP = heading.locator('xpath=following-sibling::p');
  const stranded: string[] = [];
  const wrappedAt: number[] = [];
  for (const width of [320, 280, 240, 200]) {
    await page.setViewportSize({ width, height: 800 });
    const { lines, bad } = await subtitleP.evaluate((p) => {
      const bad: string[] = [];
      const tops = new Set<number>();
      const all = document.createRange();
      all.selectNodeContents(p);
      for (const r of Array.from(all.getClientRects())) tops.add(Math.round(r.top / 4));
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent ?? '';
        for (let i = text.indexOf('·'); i >= 0; i = text.indexOf('·', i + 1)) {
          let j = i + 1;
          while (j < text.length && /[\s⁠⁦⁧⁨]/.test(text[j]!)) j++;
          if (j >= text.length) continue;
          const dot = document.createRange();
          dot.setStart(n, i);
          dot.setEnd(n, i + 1);
          const next = document.createRange();
          next.setStart(n, j);
          next.setEnd(n, j + 1);
          const dotTop = dot.getClientRects()[0]?.top ?? 0;
          const nextTop = next.getClientRects()[0]?.top ?? 0;
          if (Math.abs(dotTop - nextTop) > 4) bad.push(text.slice(i, j + 6));
        }
      }
      return { lines: tops.size, bad };
    });
    if (lines > 1) wrappedAt.push(width);
    stranded.push(...bad.map((b) => `${width}px: ${b}`));
  }
  expect(wrappedAt, 'the subtitle never wraps at the tested widths, so the stranded-dot check proves nothing').not.toEqual([]);
  expect.soft(stranded).toEqual([]);
  await page.setViewportSize({ width: 360, height: 800 });
  // PR-14b (d): ".ics" is an LTR isolate, so its dot cannot jump to the other side in Arabic.
  const calendar = await page.getByText(/\.ics/).first().innerText();
  expect.soft(calendar).toContain('⁦.ics⁩');
});

test('PR-14b: in Arabic the web address still reads "/b/" then the slug; the login placeholder keeps its order', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/signup');
  const prefix = (await page.getByText('/b/', { exact: true }).first().boundingBox())!;
  const slug = (await page.locator('input[name="slug"]').boundingBox())!;
  expect(prefix.x, 'the /b/ prefix sits before the slug').toBeLessThan(slug.x);
  await expectNoPageOverflow(page);
  await page.goto('/login');
  const placeholder = await page.locator('input[placeholder*="you@example.com"]').first().getAttribute('placeholder');
  expect(placeholder).toContain('⁦70 000 001⁩'); // the example number is an LTR isolate
  // Rendered, the digit groups read 70, 000, 001 from left to right (without the isolate they came out as 001 000 70).
  const order = await page.evaluate((text) => {
    const el = document.createElement('div');
    el.dir = 'ltr';
    el.lang = 'ar';
    el.style.cssText = 'position:absolute;top:0;left:0;white-space:nowrap';
    el.textContent = text;
    document.body.appendChild(el);
    const node = el.firstChild as Text;
    const at = (needle: string) => {
      const range = document.createRange();
      const i = text.indexOf(needle);
      range.setStart(node, i);
      range.setEnd(node, i + needle.length);
      return range.getBoundingClientRect().left;
    };
    const out = { first: at('70'), second: at('000'), third: at('001') };
    el.remove();
    return out;
  }, placeholder!);
  expect(order.first).toBeLessThan(order.second);
  expect(order.second).toBeLessThan(order.third);
  // The footer address is translated too.
  await page.goto('/privacy');
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('بيروت، لبنان');
  await expect(footer).not.toContainText('Beirut, Lebanon');
});

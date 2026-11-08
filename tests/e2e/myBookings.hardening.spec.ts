import { expect, test } from './helpers/test';
import { expectNoPageOverflow } from './helpers/layout';
import { readStored, saved, savedPast, seedBookings, seedRaw, STORAGE_KEY } from './helpers/myBookings';
import { stickingOut, zoomText200 } from './helpers/overflow';
import { clockNow } from './helpers/clock';
import { mockLinkApi, mockPublicApi, SLUG } from './helpers/publicMock';

// Hardening of "My bookings on this device": stored text is untrusted (anything can be in localStorage), so the
// page must lay out and behave with absurd values. Self-contained: link endpoints are answered by page.route.

const LATIN = 'Abcdefghij'.repeat(20); // 200 characters, no break opportunity
const ARABIC = 'مرحبا'.repeat(40); // 200 characters, no break opportunity
const REF = 'R7K2M9QX4P'.repeat(3).slice(0, 32); // the 32-character clamp

const longEntry = (text: string, over = {}) =>
  saved({ businessName: text, serviceName: text, staffName: text, reference: REF, ...over });

for (const [label, text] of [
  ['Latin', LATIN],
  ['Arabic', ARABIC],
] as const) {
  for (const [width, zoom] of [
    [320, false],
    [360, false],
    [1440, false],
    [360, true],
    [320, true],
  ] as const) {
    test(`long unbroken ${label} names do not overflow at ${width}${zoom ? ' with 200% text' : ''}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await seedBookings(page, [
        longEntry(text),
        longEntry(text, { token: 'tok-second-1', reference: 'SEC222' }),
        { ...longEntry(text, { token: 'tok-past-long1', reference: 'PASTLONG1' }), startAt: savedPast().startAt, endAt: savedPast().endAt },
      ]);
      await mockLinkApi(page, { act: 'view' });
      await page.goto('/my-bookings');
      await expect(page.getByTestId('upcoming-card').first()).toBeVisible();
      await expect(page.getByTestId('status-chip').first()).toBeVisible();
      if (zoom) await zoomText200(page);
      // At 200% text the shared site header (not part of this page) can be wider than 320 px: check this page's own content.
      const scope = zoom ? 'main' : 'body';
      expect(await stickingOut(page, scope), 'elements outside the viewport').toEqual([]);
      if (!zoom) await expectNoPageOverflow(page);
      // The cancel sheet repeats the business name. (Not at 200% text: the shared site header is wider than the viewport there, which widens every fixed layer, sheet included.)
      if (zoom) return;
      await page.getByTestId('upcoming-card').first().getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await stickingOut(page), 'elements outside the viewport (sheet open)').toEqual([]);
      await expectNoPageOverflow(page);
    });
  }
}

test('the booking page strip stays inside the viewport with 200% text at 320', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockPublicApi(page);
  await seedBookings(page, Array.from({ length: 12 }, (_, i) => saved({ slug: SLUG, token: `tok-strip-${i}-xx`, reference: `STR${i}00` })));
  await page.goto(`/b/${SLUG}`);
  await expect(page.getByTestId('your-bookings-strip')).toContainText('12 bookings on this device');
  await zoomText200(page);
  expect(await stickingOut(page, '[data-testid=your-bookings-strip]')).toEqual([]);
});

test.describe('hostile stored JSON', () => {
  test('is shown as text, never fetched, never thrown', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const linkPaths: string[] = [];
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith('/api/links/')) linkPaths.push(p);
    });
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    await mockLinkApi(page, { act: 'view' });
    const good = saved({
      token: 'tok-html-valid1',
      businessName: '<img src=x onerror=alert(1)>Shop',
      serviceName: '<script>alert(2)</script>',
      staffName: '"><svg onload=alert(3)>',
      reference: '<b>X</b>',
    });
    const entries = [
      good,
      saved({ token: '../../etc/passwd', reference: 'BAD001' }),
      saved({ token: 'javascript:alert(1)', reference: 'BAD002' }),
      saved({ token: 'tok space token', reference: 'BAD003' }),
      saved({ token: 'x'.repeat(5000), reference: 'BAD004' }),
      saved({ token: 'tok-bad-slug-1', slug: '../admin', reference: 'BAD005' }),
      saved({ token: 'tok-bad-slug-2', slug: 'javascript:alert(1)', reference: 'BAD006' }),
      saved({ token: 'tok-bad-date-1', startAt: '+275760-09-13T00:00:00.000Z', endAt: 'never', reference: 'BAD007' }),
      saved({ token: 'tok-bad-type-1', serviceName: 5 as unknown as string, reference: 'BAD008' }),
      saved({ token: 'tok-huge-name1', businessName: 'x'.repeat(100_000), reference: 'BAD009' }),
      null,
      'text',
      [],
    ];
    await seedRaw(page, JSON.stringify({ v: 1, entries }));
    await page.goto('/my-bookings');
    await expect(page.getByTestId('upcoming-card')).toHaveCount(1);
    const card = page.getByTestId('upcoming-card');
    // Rendered as plain text, not parsed as markup.
    await expect(card).toContainText('<img src=x onerror=alert(1)>Shop');
    await expect(card).toContainText('<script>alert(2)</script>');
    await expect(page.locator('main img, main svg[onload], main script')).toHaveCount(0);
    // Only the one valid token was ever used in a request, and as one encoded path segment.
    expect(linkPaths).toEqual(['/api/links/tok-html-valid1']);
    expect(dialogs).toBe(0);
    expect(errors).toEqual([]);
    // Invalid entries are not shown anywhere (not even under Previous visits).
    await expect(page.getByTestId('past-card')).toHaveCount(0);
    await expect(page.getByText('BAD00')).toHaveCount(0);
  });

  test('a booking link to an invalid slug is never rendered as a link', async ({ page }) => {
    await seedRaw(page, JSON.stringify({ v: 1, entries: [saved({ slug: '../admin' }), savedPast({ slug: 'javascript:alert(1)' })] }));
    await page.goto('/my-bookings');
    await expect(page.getByTestId('my-bookings-empty')).toBeVisible();
    await expect(page.locator('a[href*="javascript:"], a[href*=".."]')).toHaveCount(0);
  });
});

test.describe('the clock keeps moving', () => {
  test('a booking that starts while the page is open moves out of Upcoming', async ({ page }) => {
    // Starts 90 virtual seconds from now.
    const base = saved({}, 0);
    const t0 = clockNow().toMillis();
    const entry = { ...base, startAt: new Date(t0 + 90_000).toISOString(), endAt: new Date(t0 + 90_000 + 1_800_000).toISOString() };
    await seedBookings(page, [entry]);
    await mockLinkApi(page, { act: 'view' });
    await page.goto('/my-bookings');
    await expect(page.getByTestId('upcoming-card')).toHaveCount(1);
    await expect(page.getByTestId('past-card')).toHaveCount(0);
    // Two minutes pass (one-minute ticks).
    for (let i = 0; i < 3; i += 1) await page.clock.runFor(60_000);
    await expect(page.getByTestId('past-card')).toHaveCount(1);
    await expect(page.getByTestId('upcoming-card')).toHaveCount(0);
    await expect(page.getByText('Nothing coming up.')).toBeVisible();
  });
});

test.describe('Forget also clears the confirmation kept in this tab', () => {
  test('sessionStorage booked state (it holds the client name) is removed', async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__seeded2')) return;
      sessionStorage.setItem('__seeded2', '1');
      sessionStorage.setItem('maw3ed:booked:studio-nour', JSON.stringify({ name: 'Maya Haddad', hasEmail: true }));
      sessionStorage.setItem('maw3ed:booked:other-place', JSON.stringify({ name: 'Maya Haddad', hasEmail: false }));
      sessionStorage.setItem('unrelated', 'keep');
    });
    await seedBookings(page, [savedPast()]);
    await page.goto('/my-bookings');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('maw3ed:booked:studio-nour'))).not.toBeNull();
    await page.getByRole('button', { name: 'Forget my bookings on this device' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Forget bookings' }).click();
    await expect(page.getByTestId('my-bookings-empty')).toBeVisible();
    expect(await readStored(page)).toBeNull();
    const left = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('maw3ed:booked:')));
    expect(left).toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem('unrelated'))).toBe('keep');
    void STORAGE_KEY;
  });
});

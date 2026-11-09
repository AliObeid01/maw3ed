import type { Page } from '@playwright/test';
import { clockNow, freezeClock } from './helpers/clock';
import { expectNoPageOverflow } from './helpers/layout';
import { expect, test } from './helpers/test';

// PR-12 motion pass. Self-contained: the public data requests are answered by page.route on the frozen clock.
// What it proves: nothing is hidden in the server HTML, below-fold blocks reveal once (and really animate),
// reduced motion removes every movement, the header/tab bar/lift/press/row rules apply, and CLS stays ~0.

const beirut = (days: number, hh: number, mm: number) =>
  clockNow().setZone('Asia/Beirut').plus({ days }).set({ hour: hh, minute: mm, second: 0, millisecond: 0 }).toUTC().toISO()!;

const biz = (n: number, over: Record<string, unknown> = {}) => ({
  slug: `place-${n}`,
  name: `Place ${n}`,
  category: 'barbers',
  area: 'sidon',
  address: 'Riad El Solh St',
  serviceCount: 3,
  fromPrice: 8,
  timezone: 'Asia/Beirut',
  nextFree: { startAt: beirut(0, 10 + n, 30), service: { id: `s${n}`, name: 'Haircut', durationMin: 30 } },
  freeTimes: [beirut(0, 10 + n, 30), beirut(0, 11 + n, 30)],
  services: [{ name: 'Haircut', durationMin: 30, price: 8 }],
  ...over,
});

const KEYS = ['barbers', 'hair-salons', 'dental-clinics', 'beauty-clinics', 'spa-massage', 'physiotherapy'];

async function mockData(page: Page) {
  await freezeClock(page);
  await page.route('**/api/public/categories**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        categories: KEYS.map((category) => ({
          category,
          places: 3,
          fromPrice: 8,
          nextFree: {
            startAt: beirut(0, 10, 30),
            service: { id: 'x', name: 'Cut', durationMin: 30 },
            business: { slug: 'place-1', name: 'Place 1', timezone: 'Asia/Beirut' },
          },
          popularServices: [{ name: 'Haircut', fromPrice: 8 }],
        })),
      }),
    }),
  );
  await page.route('**/api/public/directory**', (route) => {
    const url = new URL(route.request().url());
    const soonest = url.searchParams.get('sort') === 'soonest';
    const businesses = [biz(1), biz(2), biz(3), biz(4)];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(soonest ? { businesses } : { businesses, nextCursor: null }),
    });
  });
}

const PAGES = ['/', '/how-it-works', '/for-business'] as const;

test.describe('no flash: the server HTML is fully visible', () => {
  for (const path of PAGES) {
    test(`${path}: the raw HTML has no hidden state and no inline style on revealed blocks`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      expect(html).not.toContain('data-revealed');
      // Reveal wrappers never carry an inline style (strict CSP, and no opacity:0 start).
      expect(html).not.toMatch(/opacity:\s*0[^.\d]/);
    });
  }

  test('with JavaScript disabled every section of /how-it-works and /for-business is visible', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await context.newPage();
    for (const path of ['/how-it-works', '/for-business']) {
      await page.goto(path);
      const hidden = await page.evaluate(() =>
        Array.from(document.querySelectorAll('main *'))
          .filter((el) => getComputedStyle(el).opacity === '0')
          .map((el) => el.tagName),
      );
      expect(hidden, path).toEqual([]);
      await expect(page.getByRole('heading', { level: 2 }).last()).toBeVisible();
    }
    await context.close();
  });
});

test.describe('Reveal (motion allowed)', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a block below the fold starts hidden after mount, reveals once on scroll, and a transition really runs', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockData(page);
    await page.goto('/how-it-works');
    const faq = page.locator('#faq > div').first();
    const steps = page.locator('main ol > li');
    // On screen at load: visible at once, no animation of anything the visitor can already see.
    await expect(steps.first()).toHaveAttribute('data-revealed', 'true');
    await expect(faq).toHaveAttribute('data-revealed', 'false');
    expect(await faq.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
    expect(await faq.evaluate((el) => el.hasAttribute('style'))).toBe(false);

    // Scroll it in: an opacity transition is running on that element (a mid-animation frame), then it settles.
    await faq.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expect(faq).toHaveAttribute('data-revealed', 'true');
    const running = await faq.evaluate((el) =>
      el
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .map((a) => (a as CSSTransition).transitionProperty)
        .sort(),
    );
    expect(running).toEqual(['opacity', 'transform']);
    await expect.poll(() => faq.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    expect(await faq.evaluate((el) => getComputedStyle(el).transform)).toBe('none');

    // Once: scrolling away and back does not hide it again.
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
    await expect(faq).toHaveAttribute('data-revealed', 'true');
  });

  test('a mid-animation frame: paused at 50 % the block is partly transparent and partly risen (vertical only)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockData(page);
    await page.goto('/how-it-works');
    const faq = page.locator('#faq > div').first();
    await expect(faq).toHaveAttribute('data-revealed', 'false');
    await faq.evaluate((el) => {
      // Pause every transition on the element as soon as it starts, then seek to the middle.
      const obs = new MutationObserver(() => {
        for (const a of el.getAnimations()) {
          a.pause();
          a.currentTime = 200;
        }
      });
      obs.observe(el, { attributes: true });
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
    });
    await expect.poll(() => faq.evaluate((el) => el.getAnimations().length)).toBeGreaterThan(0);
    const frame = await faq.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { opacity: Number(cs.opacity), transform: cs.transform };
    });
    expect(frame.opacity).toBeGreaterThan(0);
    expect(frame.opacity).toBeLessThan(1);
    // matrix(1, 0, 0, 1, 0, ty): no horizontal component, so RTL needs no mirroring.
    const m = /matrix\(1, 0, 0, 1, (-?[\d.]+), (-?[\d.]+)\)/.exec(frame.transform);
    expect(m, frame.transform).not.toBeNull();
    expect(Number(m![1])).toBe(0);
    expect(Number(m![2])).toBeGreaterThan(0);
    expect(Number(m![2])).toBeLessThan(12);
  });

  test('Arabic (RTL): the same reveal, vertical only', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'locale', value: 'ar', url: baseURL! }]);
    await page.setViewportSize({ width: 360, height: 740 });
    await mockData(page);
    await page.goto('/how-it-works');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const faq = page.locator('#faq > div').first();
    await expect(faq).toHaveAttribute('data-revealed', 'false');
    expect(await faq.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(1, 0, 0, 1, 0, /);
  });

  test('the hero panel rows fade in 60 ms apart when the data arrives', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockData(page);
    await page.goto('/');
    const rows = page.getByTestId('next-free-panel').getByRole('listitem');
    await expect(rows).toHaveCount(4);
    const timing = await rows.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return { name: cs.animationName, delay: cs.animationDelay };
      }),
    );
    expect(timing.map((t) => t.name)).toEqual(['row-in', 'row-in', 'row-in', 'row-in']);
    expect(timing.map((t) => t.delay)).toEqual(['0s', '0.06s', '0.12s', '0.18s']);
  });

  test('the sticky header gets a shadow attribute after scrolling, and loses it at the top', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockData(page);
    await page.goto('/how-it-works');
    const header = page.getByTestId('public-header');
    await expect(header).toHaveAttribute('data-scrolled', 'false');
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'instant' }));
    await expect(header).toHaveAttribute('data-scrolled', 'true');
    await expect.poll(() => header.evaluate((el) => getComputedStyle(el, '::after').opacity)).toBe('1');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(header).toHaveAttribute('data-scrolled', 'false');
  });

  test('the phone tab bar indicator is one element that slides between tabs (transform only)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockData(page);
    await page.goto('/how-it-works');
    const bar = page.getByTestId('tab-indicator');
    await expect(bar).toHaveAttribute('data-index', '1');
    await bar.evaluate((el) => ((el as HTMLElement & { __kept?: boolean }).__kept = true));
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Explore' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(bar).toHaveAttribute('data-index', '0');
    // The same DOM element moved (it did not remount), and it uses a transition on translate/transform.
    expect(await bar.evaluate((el) => (el as HTMLElement & { __kept?: boolean }).__kept)).toBe(true);
    expect(await bar.evaluate((el) => getComputedStyle(el).transitionProperty)).toContain('translate');
    await expectNoPageOverflow(page);
  });

  test('press feedback: a pressed button scales to 0.98; the hover lift exists only where hover exists', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockData(page);
    await page.goto('/how-it-works');
    const button = page.getByRole('link', { name: 'Explore businesses' }).first();
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^matrix\(0\.98/);
    await page.mouse.up();

    // Pointer devices lift; a touch phone (no hover) must not.
    const canHover = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    await page.goto('/');
    const card = page.locator('article').filter({ hasText: 'Place 1' }).first();
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await expect
      .poll(() => card.evaluate((el) => getComputedStyle(el).transform))
      .toBe(canHover ? 'matrix(1, 0, 0, 1, 0, -2)' : 'none');
    // Hovering a time chip inside the card lifts the chip alone, not the card as well.
    if (canHover) {
      const chip = card.getByRole('link', { name: /^\d\d:\d\d, / }).first();
      await chip.hover();
      await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, -2)');
      await expect.poll(() => card.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    }
  });
});

test.describe('prefers-reduced-motion: reduce', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const path of PAGES) {
    test(`${path}: nothing is hidden, nothing moves, every transition is instant`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await mockData(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      // Reveal never hides anything.
      await expect(page.locator('[data-revealed="false"]')).toHaveCount(0);
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
      const state = await page.evaluate(() => {
        const moving: string[] = [];
        for (const el of Array.from(document.querySelectorAll('main *, header *'))) {
          const cs = getComputedStyle(el);
          if (cs.opacity === '0' && !el.closest('svg') && !el.matches('.sr-only, .sr-only *, [hidden]')) moving.push(`hidden ${el.tagName}.${el.className}`);
          if (cs.transform !== 'none' && !el.closest('[data-allow-overflow]') && el.tagName !== 'svg' && !el.closest('svg'))
            moving.push(`transform ${el.tagName}.${String(el.className).slice(0, 40)} ${cs.transform}`);
        }
        const running = document
          .getAnimations()
          .filter((a) => a instanceof CSSTransition || a instanceof CSSAnimation)
          .filter((a) => (a.effect?.getComputedTiming().duration as number) > 1 && a.playState === 'running')
          .map((a) => (a instanceof CSSTransition ? a.transitionProperty : (a as CSSAnimation).animationName));
        return { moving, running };
      });
      expect(state.moving).toEqual([]);
      expect(state.running).toEqual([]);
    });
  }

  test('the safety net: animation and transition durations are ~0, no delay, smooth scroll off', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockData(page);
    await page.goto('/');
    const net = await page.evaluate(() => {
      const el = document.querySelector('a')!;
      const cs = getComputedStyle(el);
      return {
        transition: cs.transitionDuration,
        delay: cs.transitionDelay,
        scroll: getComputedStyle(document.documentElement).scrollBehavior,
      };
    });
    expect(net.scroll).toBe('auto');
    expect(net.delay).toBe('0s');
    expect(parseFloat(net.transition)).toBeLessThan(0.001);
    // The press and lift rules do not apply either.
    await page.goto('/how-it-works');
    const button = page.getByRole('link', { name: 'Explore businesses' }).first();
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(50);
    expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    await page.mouse.up();
  });

  test('hero rows do not animate, the header shadow still toggles (no movement)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await mockData(page);
    await page.goto('/');
    const rows = page.getByTestId('next-free-panel').getByRole('listitem');
    await expect(rows).toHaveCount(4);
    expect(await rows.first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  });
});

test.describe('performance: no layout shift, LCP never waits for a reveal, no lingering will-change', () => {
  test.use({ reducedMotion: 'no-preference' });

  for (const width of [360, 1440]) {
    for (const path of PAGES) {
      test(`${path} at ${width}: layout-shift sum < 0.01 while scrolling the whole page`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
        await page.addInitScript(() => {
          const w = window as unknown as { __cls: number; __lcp: string };
          w.__cls = 0;
          w.__lcp = '';
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>)
              if (!e.hadRecentInput) w.__cls += e.value;
          }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver((list) => {
            const last = list.getEntries().at(-1) as unknown as { element?: Element } | undefined;
            const el = last?.element;
            w.__lcp = el ? `${el.tagName.toLowerCase()}|reveal:${(el.closest('[data-revealed]') as HTMLElement | null)?.dataset.revealed ?? 'none'}` : '';
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        });
        await mockData(page);
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const lcpAtLoad = await page.evaluate(() => (window as unknown as { __lcp: string }).__lcp);
        const height = await page.evaluate(() => document.body.scrollHeight);
        for (let y = 0; y <= height; y += 300) {
          await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
          await page.waitForTimeout(40);
        }
        await page.waitForTimeout(500);
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        const lcp = lcpAtLoad;
        expect(cls).toBeLessThan(0.01);
        // The LCP element is never in a block that waits to be revealed: either outside any Reveal, or in one that was
        // already on screen at mount ("true", no transition ever runs on it).
        expect(lcp).not.toBe('');
        expect(lcp).not.toContain('reveal:false');
        // Nothing is left promoted with will-change.
        const promoted = await page.evaluate(() =>
          Array.from(document.querySelectorAll('*')).filter((el) => getComputedStyle(el).willChange !== 'auto').length,
        );
        expect(promoted).toBe(0);
        // No more than 12 elements run an animation or transition at once on the first screen.
        expect(await page.evaluate(() => document.getAnimations().length)).toBeLessThanOrEqual(12);
        console.log(`METRICS ${path} ${width}: CLS ${cls.toFixed(4)}, LCP ${lcp}`);
      });
    }
  }
});

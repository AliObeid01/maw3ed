import { expect, test } from './helpers/test';

// F69-C: favicon, app icons, manifest and the static logo files are linked from <head>, served with 200 on the
// production build, and do not trip the strict CSP (same-origin images and manifest only).

test('head links the favicon, svg icon, apple icon and manifest, and the theme colour is unchanged', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  const hrefs = await page.evaluate(() => ({
    icons: [...document.querySelectorAll('link[rel~="icon"]')].map((l) => [l.getAttribute('href'), l.getAttribute('type')]),
    apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
    theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  }));
  expect(hrefs.icons.some(([h]) => /favicon\.ico/.test(h ?? ''))).toBe(true);
  expect(hrefs.icons.some(([h, t]) => /icon\.svg/.test(h ?? '') && t === 'image/svg+xml')).toBe(true);
  expect(hrefs.apple).toMatch(/apple-icon\.png/);
  expect(hrefs.manifest).toBe('/manifest.webmanifest');
  expect(hrefs.theme?.toLowerCase()).toBe('#f3f5fa');

  const urls = [...hrefs.icons.map(([h]) => h!), hrefs.apple!, hrefs.manifest!];
  for (const url of urls) {
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(200);
  }
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Maw3ed', short_name: 'Maw3ed', start_url: '/', display: 'standalone' });
  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const res = await page.request.get(icon.src);
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toContain(icon.type);
  }
  // The static email logos are plain files: no proxy, no CSP, no redirect.
  for (const file of ['reverse', 'light']) {
    for (const w of [160, 320, 480]) {
      const res = await page.request.get(`/brand/maw3ed-email-logo-${file}-${w}w.png`, { maxRedirects: 0 });
      expect(res.status(), `${file} ${w}w`).toBe(200);
      expect(res.headers()['content-type']).toContain('image/png');
    }
  }
  expect(violations).toEqual([]);
});

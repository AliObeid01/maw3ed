import { expect, test } from './helpers/test';

// Security headers on the production build (e2e serves `pnpm start`): a per-request CSP nonce and the static headers.

const nonceOf = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1];

test('home and login send a CSP with a fresh nonce per load plus the static headers', async ({ page }) => {
  const seen: string[] = [];
  for (const path of ['/', '/login', '/']) {
    const response = await page.goto(path);
    const headers = response!.headers();
    const csp = headers['content-security-policy'];
    expect(csp, path).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(inline|eval)'/);
    const nonce = nonceOf(csp);
    expect(nonce, path).toBeTruthy();
    seen.push(nonce!);
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['x-powered-by']).toBeUndefined();
    // Every inline script Next emitted carries this request's nonce (a missing one would be blocked).
    const inline = await page.evaluate(() =>
      [...document.scripts].filter((s) => !s.src).map((s) => s.nonce || s.getAttribute('nonce') || ''),
    );
    expect(inline.length).toBeGreaterThan(0);
    for (const n of inline) expect(n, path).toBe(nonce);
  }
  expect(new Set(seen).size).toBe(seen.length);
});

test('token routes keep no-referrer and no-store; the rest use strict-origin-when-cross-origin (real Next)', async ({ request }) => {
  for (const path of ['/l/x', '/o/x', '/pay/x', '/invite/x', '/verify-email/x', '/reset-password/x']) {
    const headers = (await request.get(path)).headers();
    expect(headers['referrer-policy'], path).toBe('no-referrer');
    expect(headers['cache-control'], path).toContain('no-store');
  }
  expect((await request.get('/')).headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
});

test('the API is not given the page policy', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.headers()['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  expect(response.headers()['x-frame-options']).toBe('DENY');
});

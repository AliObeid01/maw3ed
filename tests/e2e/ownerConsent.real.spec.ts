import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';

/**
 * The REAL consent form in a real browser (no hand-set Origin header): sign up a fresh OWNER in the LOCAL database,
 * open /oauth/authorize, press Allow and check the browser goes to the claude.ai callback with code and state.
 * The external callback is intercepted (answered by the test), so nothing leaves the machine.
 *
 * Needs a server with MCP_OWNER_ENABLED=true and a local database; skipped unless OWNER_REAL_URL names it, e.g.
 *   OWNER_REAL_URL=http://localhost:3201 pnpm exec playwright test tests/e2e/ownerConsent.real.spec.ts --project=desktop
 * (with BASE_URL set so Playwright does not start its own servers).
 */
const REAL = process.env.OWNER_REAL_URL;
test.skip(!REAL, 'needs a server with MCP_OWNER_ENABLED=true and a local database (OWNER_REAL_URL)');
// Nothing may leave the machine: the browser cannot resolve claude.ai / claude.com, so the redirect to the callback
// fails right there. The attempted request (a redirect hop is not interceptable with page.route) is read from the
// 'request' event instead.
test.use({
  baseURL: REAL,
  launchOptions: { args: ['--host-resolver-rules=MAP claude.ai ~NOTFOUND, MAP claude.com ~NOTFOUND'] },
});

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

async function signedInOwner(page: import('@playwright/test').Page) {
  const id = randomBytes(4).toString('hex');
  const res = await page.request.post('/api/auth/signup', {
    data: {
      businessName: `Consent ${id}`,
      slug: `consent-${id}`,
      timezone: 'Asia/Beirut',
      ownerName: 'Owner',
      email: `owner-${id}@example.test`,
      password: 'correct-horse-battery-1',
    },
  });
  expect(res.status()).toBeLessThan(300);
  return id;
}

function authorizeUrl(state: string) {
  const challenge = createHash('sha256').update(randomBytes(32)).digest('base64url');
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: 'maw3ed-claude',
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    scope: 'setup',
  });
  return `/oauth/authorize?${q.toString()}`;
}

test('Allow: the real form post redirects the browser to the claude.ai callback with code and state', async ({ page }) => {
  await signedInOwner(page);
  const requested: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(CALLBACK)) requested.push(r.url());
  });
  await page.goto(authorizeUrl('state-allow-1'));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Claude wants to set up Consent');
  await expect(page.getByText('claude.ai', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  const url = new URL(requested[0]!);
  expect(url.origin + url.pathname).toBe(CALLBACK);
  expect(url.searchParams.get('state')).toBe('state-allow-1');
  expect(url.searchParams.get('code')).toMatch(/\S{20,}/);
  expect(url.searchParams.get('error')).toBeNull();
});

test('Cancel: the browser goes to the callback with access_denied and the state', async ({ page }) => {
  await signedInOwner(page);
  const requested: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(CALLBACK)) requested.push(r.url());
  });
  await page.goto(authorizeUrl('state-deny-1'));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(3000);
  console.log('PAGEURL', page.url(), requested);
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  const url = new URL(requested[0]!);
  expect(url.searchParams.get('error')).toBe('access_denied');
  expect(url.searchParams.get('state')).toBe('state-deny-1');
  expect(url.searchParams.get('code')).toBeNull();
});

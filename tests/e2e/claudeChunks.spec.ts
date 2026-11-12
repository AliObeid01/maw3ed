import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JOURNEY_URL } from './helpers/journeyEnv';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// PR-16 item 4a: the code of the Claude surfaces ("Book with Claude" button and sheet) is a separate chunk, fetched
// only when the button renders. The default e2e server has MCP_ENABLED=true; the journey server has no such variable
// and is the "switched off" server. Needs the production build (.next/static), like the rest of the public specs.

const CHUNK_DIR = join(process.cwd(), '.next', 'static', 'chunks');

/** Test ids that only the Claude button and sheet render (src/components/booking/ClaudeButton.tsx). */
const CLAUDE_MARKERS = ['claude-button', 'claude-prompt', 'claude-copy'] as const;
/** A translation key that only the booking flow's own code uses (src/components/booking/BookingFlow.tsx). */
const BOOKING_MARKER = 'heroFactReminders';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith('.js') ? [full] : [];
  });
}

/** Every built chunk once, with its text (read once per worker, so every test sees the same files). */
let cache: { name: string; text: string }[] | undefined;
function chunks() {
  if (!cache) {
    if (!existsSync(CHUNK_DIR)) throw new Error(`No production build at ${CHUNK_DIR}: run pnpm build first.`);
    cache = walk(CHUNK_DIR)
      .sort()
      .map((file) => ({ name: file.split(/[\\/]/).pop()!, text: readFileSync(file, 'utf8') }));
  }
  return cache;
}

/** Names of the built chunks that hold the Claude button's own markers (ALL of them, so a shared chunk with one id does not count). */
const claudeChunks = () => chunks().filter((c) => CLAUDE_MARKERS.every((m) => c.text.includes(m))).map((c) => c.name);
/** Names of the built chunks that hold the booking flow's own code. */
const bookingChunks = () => chunks().filter((c) => c.text.includes(BOOKING_MARKER)).map((c) => c.name);

/** The file name of a requested script URL (exact match, not a substring of some other file name). */
const fileOf = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');

test('the Claude code is its own chunk(s), not part of the booking page chunks', () => {
  const claude = claudeChunks();
  const booking = bookingChunks();
  expect(claude.length).toBeGreaterThan(0);
  // The marker for the booking flow must exist somewhere, or the check below proves nothing.
  expect(booking.length).toBeGreaterThan(0);
  // The chunk holds the Claude sheet only: it must not also contain the booking flow's own code.
  for (const name of claude) expect(booking.includes(name), `${name} also holds the booking flow`).toBe(false);
});

test('switched on and a listed business: the Claude chunk IS requested (so the next test is not vacuous)', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await mockPublicApi(page, { listed: true });
  await page.goto(`/b/${SLUG}`);
  await expect(page.getByTestId('claude-button')).toBeVisible();
  const names = claudeChunks();
  expect(requested.some((u) => names.includes(fileOf(u)))).toBe(true);
});

test('switched off (journey server): neither the home page nor a listed business page requests the Claude chunk', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await mockPublicApi(page, { listed: true });
  await page.goto(`${JOURNEY_URL}/`);
  await expect(page.locator('#categories-title')).toBeVisible();
  await page.goto(`${JOURNEY_URL}/b/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Studio Nour' })).toBeVisible();
  await expect(page.getByTestId('claude-button')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  const names = claudeChunks();
  expect(names.length).toBeGreaterThan(0);
  const scripts = requested.filter((u) => u.includes('/_next/static/'));
  expect(scripts.length).toBeGreaterThan(3); // the page really loaded its JS
  for (const name of names) {
    expect(scripts.some((u) => fileOf(u) === name), `${name} was requested while the connector is off`).toBe(false);
  }
});

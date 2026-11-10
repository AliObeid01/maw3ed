import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JOURNEY_URL } from './helpers/journeyEnv';
import { mockPublicApi, SLUG } from './helpers/publicMock';
import { expect, test } from './helpers/test';

// PR-16 item 4a: the code of the Claude surfaces ("Book with Claude" button and sheet) is a separate chunk, fetched
// only when the button renders. The default e2e server has MCP_ENABLED=true; the journey server has no such variable
// and is the "switched off" server. Needs the production build (.next/static), like the rest of the public specs.

const CHUNK_DIR = join(process.cwd(), '.next', 'static', 'chunks');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : name.endsWith('.js') ? [full] : [];
  });
}

/** Names of the built chunks that contain the button's own markers (its test ids). */
function claudeChunks(): string[] {
  return walk(CHUNK_DIR)
    .filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('claude-copy') && text.includes('claude-prompt');
    })
    .map((file) => file.split(/[\\/]/).pop()!);
}


test('the Claude code is its own chunk(s), not part of the booking page chunks', () => {
  const chunks = claudeChunks();
  expect(chunks.length).toBeGreaterThan(0);
  // The chunk holds the Claude sheet only: it must not also contain the booking flow's own code.
  for (const name of chunks) {
    const text = readFileSync(join(CHUNK_DIR, name), 'utf8');
    expect(text.includes('heroFactReminders'), `${name} also holds the booking flow`).toBe(false);
  }
});

test('switched on and a listed business: the Claude chunk IS requested (so the next test is not vacuous)', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await mockPublicApi(page, { listed: true });
  await page.goto(`/b/${SLUG}`);
  await expect(page.getByTestId('claude-button')).toBeVisible();
  const names = claudeChunks();
  expect(requested.some((u) => names.some((n) => u.includes(n)))).toBe(true);
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
    expect(scripts.some((u) => u.includes(name)), `${name} was requested while the connector is off`).toBe(false);
  }
});

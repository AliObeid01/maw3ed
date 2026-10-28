#!/usr/bin/env node
// Renders maw3ed-design.html in Chromium and screenshots every board to design/boards/<slug>.png.
// Requires Playwright (installed in Phase 0): pnpm exec playwright install chromium
// Usage: node scripts/design/snapshot-boards.mjs [path/to/maw3ed-design.html] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const src = path.resolve(process.argv[2] ?? 'maw3ed-design.html');
const outDir = process.argv[3] ?? 'design/boards';
const slugify = (s) =>
  s.toLowerCase().replace(/&/g, 'and').replace(/·\s*web/g, '').replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto(pathToFileURL(src).href);
// The bundle unpacks itself, then each board iframe unpacks its own bundle.
await page.waitForSelector('section.board iframe', { timeout: 60_000 });
await page.waitForLoadState('networkidle');
await page.waitForTimeout(4000);

const boards = await page.$$('section.board');
let n = 0;
for (const board of boards) {
  const title = (await board.$eval('h2', (h) => h.textContent ?? '')).trim();
  const frame = await board.$('iframe');
  if (!frame) continue;
  n += 1;
  const file = path.join(outDir, `${String(n).padStart(2, '0')}-${slugify(title)}.png`);
  await frame.scrollIntoViewIfNeeded();
  // Wait for the nested bundle to unpack: the frame body needs real content and loaded fonts.
  const content = await frame.contentFrame();
  await content?.waitForFunction(() => document.body && document.body.innerText.trim().length > 20 && document.querySelectorAll('*').length > 30, null, { timeout: 30_000 });
  await content?.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await frame.screenshot({ path: file });
  console.log(`✓ ${file}`);
}
await browser.close();
console.log(`Saved ${n} board screenshots to ${outDir}`);

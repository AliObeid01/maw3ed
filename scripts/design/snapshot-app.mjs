#!/usr/bin/env node
// Screenshots app routes at several widths (and optionally RTL) for design QA.
// Usage: node scripts/design/snapshot-app.mjs --routes /b/studio-nour,/app --widths 360,768,1440 [--rtl] [--base http://localhost:3000]
// Signed-in routes: set STORAGE_STATE=tests/e2e/.auth/owner.json (written by the Playwright auth setup).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
    return acc;
  }, []),
);
const base = args.base ?? process.env.BASE_URL ?? 'http://localhost:3000';
const routes = (args.routes ?? '/').split(',');
const widths = (args.widths ?? '360,768,1440').split(',').map(Number);
const rtl = args.rtl === 'true';
const outDir = args.out ?? 'design/app-shots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const width of widths) {
  const context = await browser.newContext({
    viewport: { width, height: width < 768 ? 800 : 1000 },
    deviceScaleFactor: width < 768 ? 2 : 1,
    isMobile: width < 768,
    hasTouch: width < 768,
    storageState: process.env.STORAGE_STATE || undefined,
  });
  const page = await context.newPage();
  for (const route of routes) {
    const url = new URL(route, base);
    if (rtl) url.searchParams.set('lang', 'ar');
    await page.goto(url.href, { waitUntil: 'networkidle' });
    const name = `${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}-${width}${rtl ? '-rtl' : ''}.png`;
    const file = path.join(outDir, name);
    await page.screenshot({ path: file, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(`${overflow ? '⚠ horizontal overflow' : '✓'} ${file}`);
  }
  await context.close();
}
await browser.close();

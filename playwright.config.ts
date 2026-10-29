import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? 3100);
const baseURL = process.env.BASE_URL ?? `http://localhost:${port}`;
const dashboardURL = `http://localhost:${dashboardPort}`;

const PUBLIC_PROJECTS = ['mobile', 'desktop'];
const DASHBOARD_PROJECTS = ['dashboard-mobile', 'dashboard-desktop'];

// Playwright starts web servers for the whole run, so start only what the selected projects need:
// `--project=mobile` (public specs) never boots the dev server, `--project=dashboard-*` never needs a build.
const selected = process.argv
  .filter((arg) => arg.startsWith('--project='))
  .map((arg) => arg.slice('--project='.length));
const needs = (names: string[]) =>
  selected.length === 0 || selected.some((name) => names.includes(name));

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    // Public and auth pages: production build (`next start`).
    { name: 'mobile', testIgnore: /dashboard\//, use: { ...devices['Pixel 5'] } },
    { name: 'desktop', testIgnore: /dashboard\//, use: { ...devices['Desktop Chrome'] } },
    // Dashboard: `next dev` with a fake session (E2E_FAKE_SESSION=1, refused in production builds); every
    // /api call is answered by page.route, so no database is needed.
    {
      name: 'dashboard-mobile',
      testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...devices['Pixel 5'], baseURL: dashboardURL },
    },
    {
      name: 'dashboard-desktop',
      testMatch: /dashboard\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: dashboardURL },
    },
  ],
  // `next dev` writes to .next/dev and `next start` reads .next, so the two servers do not collide.
  webServer: process.env.BASE_URL
    ? undefined
    : [
        ...(needs(PUBLIC_PROJECTS)
          ? [
              {
                command: 'pnpm start',
                url: baseURL,
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
              },
            ]
          : []),
        ...(needs(DASHBOARD_PROJECTS)
          ? [
              {
                command: `pnpm exec next dev -p ${dashboardPort}`,
                url: `${dashboardURL}/login`,
                env: { E2E_FAKE_SESSION: '1' },
                reuseExistingServer: !process.env.CI,
                timeout: 180_000,
              },
            ]
          : []),
      ],
});

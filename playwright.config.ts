import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
const dashboardPort = Number(process.env.DASHBOARD_PORT ?? 3100);
const baseURL = process.env.BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  // Two servers: the production build for the public and auth pages, and a dev server with a fake dashboard
  // session (E2E_FAKE_SESSION=1, ignored whenever NODE_ENV is production) for the specs under
  // tests/e2e/dashboard, which answer every /api call with page.route and need no database.
  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm start',
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: `pnpm exec next dev -p ${dashboardPort}`,
          url: `http://localhost:${dashboardPort}/login`,
          env: { E2E_FAKE_SESSION: '1' },
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ],
});

import { defineConfig, devices } from '@playwright/test';
import {
  JOURNEY_APP_URL,
  JOURNEY_PORT,
  JOURNEY_URL,
  OUTBOX_FILE,
  RESEND_STUB,
} from './tests/e2e/helpers/journeyEnv';
// Importing the clock also fixes the shared real start instant (E2E_REAL_T0) before any worker starts.
import { CLOCK_OFFSET_MS } from './tests/e2e/helpers/clock';

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
  // Two workers everywhere: the suite is CPU-sensitive (auth specs time out when oversubscribed).
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
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
        // Real-stack waitlist journey (F26): the same production build on its own port, talking to the real
        // database, with the REAL Resend provider whose one HTTPS call is answered by a preloaded local stub
        // that writes every email to a file. (EMAIL_PROVIDER=fake cannot run in a production build.)
        ...(needs(PUBLIC_PROJECTS)
          ? [
              {
                command: `pnpm exec next start -p ${JOURNEY_PORT}`,
                url: `${JOURNEY_URL}/api/health`,
                reuseExistingServer: !process.env.CI,
                timeout: 120_000,
                env: {
                  EMAIL_PROVIDER: 'resend',
                  RESEND_API_KEY: 'e2e-stub-key',
                  EMAIL_FROM: 'Maw3ed <bookings@example.test>',
                  APP_URL: JOURNEY_APP_URL,
                  NEXT_PUBLIC_APP_URL: JOURNEY_APP_URL,
                  E2E_EMAIL_OUTBOX_FILE: OUTBOX_FILE,
                  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${RESEND_STUB}`.trim(),
                },
              },
            ]
          : []),
        ...(needs(DASHBOARD_PROJECTS)
          ? [
              {
                command: `pnpm exec next dev -p ${dashboardPort}`,
                url: `${dashboardURL}/login`,
                env: {
                  E2E_FAKE_SESSION: '1',
                  // Same virtual clock as the browser (see tests/e2e/helpers/clock.ts), so server-rendered
                  // greeting and dates match what the frozen browser clock renders.
                  E2E_CLOCK_OFFSET_MS: String(CLOCK_OFFSET_MS),
                  NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ./tests/e2e/helpers/serverClock.cjs`.trim(),
                },
                reuseExistingServer: !process.env.CI,
                timeout: 180_000,
              },
            ]
          : []),
      ],
});

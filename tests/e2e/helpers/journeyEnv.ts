import os from 'node:os';
import path from 'node:path';

/**
 * Settings shared by playwright.config.ts (which starts the journey server) and the real-stack journey spec
 * (which talks to it). The journey server is a second `next start` of the same production build with its own
 * port and email settings, so the mocked specs on the main server are untouched.
 */
export const JOURNEY_PORT = Number(process.env.JOURNEY_PORT ?? 3200);
export const JOURNEY_URL = `http://localhost:${JOURNEY_PORT}`;
/** Production builds require an https APP_URL, so the emails carry this origin; the browser opens JOURNEY_URL. */
export const JOURNEY_APP_URL = `https://localhost:${JOURNEY_PORT}`;
export const OUTBOX_FILE =
  process.env.E2E_EMAIL_OUTBOX_FILE ?? path.join(os.tmpdir(), 'maw3ed-e2e-outbox.jsonl');
/** Preloaded into the journey server: answers the Resend HTTP call locally and writes OUTBOX_FILE. */
export const RESEND_STUB = path.resolve('tests/e2e/helpers/resendStub.cjs').replace(/\\/g, '/');

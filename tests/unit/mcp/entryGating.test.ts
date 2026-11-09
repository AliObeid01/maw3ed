import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// PR-15b: every entry point to the Claude connector is gated by isAssistantEnabled() (MCP_ENABLED exactly 'true').
// The server pages read it and hand the answer down; these tests call the pages and look at what they return.

vi.mock('@/app/app/practitionerGuard', () => ({ assertPractitionerPath: async () => undefined }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));

afterEach(() => vi.unstubAllEnvs());

type El = ReactElement<{ assistantEnabled?: boolean; children?: unknown }>;
const OFF = [undefined, '', 'false', 'TRUE', '1', ' true', 'yes'];

describe('Share page (owner card)', () => {
  it('passes assistantEnabled=true only for the exact value "true"', async () => {
    const { default: Page } = await import('@/app/app/share/page');
    vi.stubEnv('MCP_ENABLED', 'true');
    expect(((await Page()) as El).props.assistantEnabled).toBe(true);
    for (const v of OFF) {
      if (v === undefined) vi.stubEnv('MCP_ENABLED', undefined as unknown as string);
      else vi.stubEnv('MCP_ENABLED', v);
      expect(((await Page()) as El).props.assistantEnabled, String(v)).toBe(false);
    }
  });
});

describe('Booking page (Book with Claude button)', () => {
  const flag = async (value: string | undefined) => {
    const { default: Page } = await import('@/app/(public)/b/[slug]/page');
    if (value === undefined) vi.stubEnv('MCP_ENABLED', undefined as unknown as string);
    else vi.stubEnv('MCP_ENABLED', value);
    const suspense = (await Page({ params: Promise.resolve({ slug: 'studio-nour' }) })) as El;
    return (suspense.props.children as El).props.assistantEnabled;
  };
  it('hands the flag to the booking flow', async () => {
    expect(await flag('true')).toBe(true);
    for (const v of OFF) expect(await flag(v), String(v)).toBe(false);
  });
});

describe('Home page (strip)', () => {
  const hasStrip = async (value: string | undefined) => {
    const { default: Home } = await import('@/app/(public)/page');
    const { ClaudeStrip } = await import('@/components/home/ClaudeStrip');
    if (value === undefined) vi.stubEnv('MCP_ENABLED', undefined as unknown as string);
    else vi.stubEnv('MCP_ENABLED', value);
    const main = (await Home()) as El;
    const children = main.props.children as Array<{ type?: unknown } | null>;
    return children.some((c) => c?.type === ClaudeStrip);
  };
  it('renders the strip only while the connector is on', async () => {
    expect(await hasStrip('true')).toBe(true);
    for (const v of OFF) expect(await hasStrip(v), String(v)).toBe(false);
  });
});

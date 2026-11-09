import { describe, expect, it } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { connectorUrl, isAssistantEnabled, PROMPT_KEYS } from '@/lib/assistant';

const env = (o: Record<string, string | undefined>) => o as NodeJS.ProcessEnv;

describe('kill switch', () => {
  it('only the exact value "true" enables the connector; unset is OFF', () => {
    expect(isAssistantEnabled(env({}))).toBe(false);
    expect(isAssistantEnabled(env({ MCP_ENABLED: 'true' }))).toBe(true);
    for (const v of ['', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ', 'enabled'])
      expect(isAssistantEnabled(env({ MCP_ENABLED: v })), JSON.stringify(v)).toBe(false);
  });
});

describe('connector url', () => {
  it('is the public origin plus /api/mcp, without a double slash', () => {
    expect(connectorUrl(env({ APP_URL: 'https://maw3ed.example/' }))).toBe('https://maw3ed.example/api/mcp');
    expect(connectorUrl(env({ NEXT_PUBLIC_APP_URL: 'https://pub.example', APP_URL: 'https://x.example' }))).toBe(
      'https://pub.example/api/mcp',
    );
    expect(connectorUrl(env({}))).toBe('http://localhost:3000/api/mcp');
  });
});

describe('assistant copy', () => {
  const PRIVACY_EN =
    'If you book through an AI assistant, the assistant provider also processes what you type, under its own privacy policy. Maw3ed stores only your name, phone, email and appointment details.';

  it('has the exact privacy sentence on the page and in the privacy policy (en)', () => {
    expect(en.assistant.privacy).toBe(PRIVACY_EN);
    expect(en.legal.privacy.sections.sharing.p3).toBe(PRIVACY_EN);
  });

  it('has an Arabic privacy sentence on both, equal to each other', () => {
    expect(ar.assistant.privacy).toBe(ar.legal.privacy.sections.sharing.p3);
    expect(ar.assistant.privacy).toMatch(/[؀-ۿ]/);
  });

  it('has the three prompts in both languages, and never says beta or claims a directory listing', () => {
    for (const m of [en, ar]) for (const k of PROMPT_KEYS) expect(m.assistant.prompts[k].length).toBeGreaterThan(10);
    const all = JSON.stringify([en.assistant, en.public.footer.assistant]).toLowerCase();
    expect(all).not.toMatch(/beta|directory listing|anthropic directory|chatgpt/);
    expect(en.assistant.requirements).toBe(
      'Works with Claude. On a free Claude plan you can add one custom connector.',
    );
    expect(en.assistant.steps.add.body).toBe(
      'In Claude open Customize, then Connectors, then Add custom connector, paste the link and save.',
    );
  });
});

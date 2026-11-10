import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, PROMPT_KEYS } from '@/lib/assistant';
import { TOOL_NAMES } from '@/server/mcp/tools';

const root = path.resolve(import.meta.dirname, '../../..');
const messages = (lang: string) =>
  JSON.parse(fs.readFileSync(path.join(root, `messages/${lang}.json`), 'utf8')).assistant as {
    prompts: Record<string, string>;
    can: { title: string; hint: string; items: Record<string, { title: string; body: string; example: string }> };
  };

describe('/assistant "What Claude can do" panel', () => {
  it('claims exactly five capabilities, each mapped to real MCP tools, together covering all nine tools', () => {
    expect(CAPABILITIES.map((c) => c.id)).toEqual(['find', 'book', 'waitlist', 'check', 'manage']);
    const used = CAPABILITIES.flatMap((c) => [...c.tools]);
    for (const tool of used) expect(TOOL_NAMES, tool).toContain(tool);
    expect([...used].sort()).toEqual([...TOOL_NAMES].sort());
  });

  for (const lang of ['en', 'ar']) {
    it(`${lang}: every capability has title, body and a distinct example, and claims nothing the tools do not do`, () => {
      const { can, prompts } = messages(lang);
      const examples = new Set<string>();
      for (const c of CAPABILITIES) {
        const item = can.items[c.id]!;
        expect(item.title && item.body && item.example, c.id).toBeTruthy();
        examples.add(item.example);
        expect(Object.values(prompts)).not.toContain(item.example);
      }
      expect(examples.size).toBe(5);
      expect(Object.keys(can.items)).toHaveLength(5);
      expect(PROMPT_KEYS).toHaveLength(3);
      const all = JSON.stringify(can);
      expect(all).not.toMatch(/\bbeta\b|reschedul|payment|\bpay\b|guarantee|directory|anthropic|always|دفع|تأجيل|إعادة جدولة|ضمان|تجريبي/i);
    });
  }
});

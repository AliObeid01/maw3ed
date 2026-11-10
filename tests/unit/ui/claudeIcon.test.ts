import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClaudeIcon } from '@/components/brand/ClaudeIcon';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('ClaudeIcon (one neutral icon for every Claude surface)', () => {
  it('renders a lucide-style svg, aria-hidden by default, size and class props', () => {
    const m = renderToStaticMarkup(createElement(ClaudeIcon, { size: 30, className: 'x' }));
    expect(m).toContain('<svg');
    expect(m).toContain('aria-hidden="true"');
    expect(m).toContain('width="30"');
    expect(m).toContain('class="x"');
    expect(m).toContain('viewBox="0 0 24 24"');
    expect(m).toContain('stroke="currentColor"');
    expect(m).toContain('stroke-width="2"');
    expect(m).toContain('fill="none"');
    expect(renderToStaticMarkup(createElement(ClaudeIcon, {}))).toContain('width="24"');
  });

  it('carries the trademark note and no disclaimer text', () => {
    const src = read('src/components/brand/ClaudeIcon.tsx');
    expect(src).toMatch(/trademark-guidelines/);
    expect(src).toMatch(/neutral\s+(\/\/\s*)?placeholder/i);
  });

  it('every Claude surface uses it, and none draws Sparkles or MessageCircle for Claude', () => {
    const surfaces = [
      'src/components/app/setup/ClaudeShareCard.tsx',
      'src/components/booking/ClaudeButton.tsx',
      'src/components/home/ClaudeStrip.tsx',
      'src/components/assistant/AssistantPage.tsx',
    ];
    for (const f of surfaces) {
      const src = read(f);
      expect(src, f).toContain('ClaudeIcon');
      expect(src, f).not.toMatch(/\bSparkles\b/);
    }
    // Claude surfaces may use MessageCircle for WhatsApp only (the share card's WhatsApp button).
    for (const f of ['src/components/booking/ClaudeButton.tsx', 'src/components/home/ClaudeStrip.tsx', 'src/components/assistant/AssistantPage.tsx'])
      expect(read(f), f).not.toMatch(/\bMessageCircle\b/);
  });
});

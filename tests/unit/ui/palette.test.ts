import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMAIL_COLORS } from '@/server/i18n/emailLayout';

const root = path.resolve(import.meta.dirname, '../../..');
const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

describe('palette v2 (blue, approved 3 Nov 2026)', () => {
  it.each([
    ['ink', '#0b1938'],
    ['navy', '#0b1938'],
    ['brand', '#254edb'],
    ['electric', '#2864f5'],
    ['cyan', '#43c4f0'],
    ['turquoise', '#21cdb3'],
    ['mint', '#20d2ac'],
    ['divider', '#e9eff8'],
    ['surface', '#ffffff'],
    ['canvas', '#f3f5fa'],
    ['line', '#d3dcee'],
    ['brand-hover', '#1d3fb8'],
    ['success', '#17795a'],
    ['success-soft', '#ddf5ec'],
    ['warning', '#9a5800'],
    ['warning-soft', '#fff1d6'],
    ['danger', '#c21f3a'],
    ['danger-soft', '#ffe4e8'],
    ['gold', '#e8b86d'],
  ])('--color-%s is %s', (name, value) => {
    expect(token(name)).toBe(value);
  });

  it('keeps the old teal and warm greys out of the theme', () => {
    expect(css).not.toMatch(/#174c4f|#f7f5f0|#252d2d|#e3ded2/i);
  });

  it('has no gradients, glows or blur in the global theme (hero is flat navy with a 4 px Royal edge)', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/gradient|blur\(|drift/i);
    const hero = /@utility bg-hero \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(hero).toContain('background-color: var(--color-navy)');
    expect(hero).toContain('border-bottom: 4px solid var(--color-brand)');
  });

  it('uses card radii of 14 to 16 px and control radii of 8 to 14 px', () => {
    const px = (n: string) => Number(new RegExp(`--radius-${n}:\\s*(\\d+)px`).exec(css)?.[1]);
    for (const n of ['card', 'card-sm', 'tile']) expect(px(n)).toBeGreaterThanOrEqual(14);
    for (const n of ['card', 'card-sm', 'tile']) expect(px(n)).toBeLessThanOrEqual(16);
    for (const n of ['input', 'btn']) {
      expect(px(n)).toBeGreaterThanOrEqual(10);
      expect(px(n)).toBeLessThanOrEqual(14);
    }
  });

  it('emails use the same blue palette', () => {
    expect(EMAIL_COLORS.brand).toBe(token('brand'));
    expect(EMAIL_COLORS.ink).toBe(token('ink'));
    expect(EMAIL_COLORS.muted).toBe(token('muted'));
    expect(EMAIL_COLORS.line).toBe(token('line'));
    expect(EMAIL_COLORS.canvas).toBe(token('canvas'));
  });

  it('never uses cyan or turquoise as a text colour or under white text in components', () => {
    const walk = (d: string): string[] =>
      fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
      );
    const offenders = walk(path.join(root, 'src'))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /text-(cyan|turquoise|mint)\b|bg-(cyan|turquoise)\b[^'"`]*text-white|text-white[^'"`]*\bbg-(cyan|turquoise)\b/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

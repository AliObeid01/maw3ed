import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMAIL_COLORS } from '@/server/i18n/emailLayout';

const root = path.resolve(import.meta.dirname, '../../..');
const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

// Read every source file once; the three scans below share it (a cold walk is slow on CI).
const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );
const sources = walk(path.join(root, 'src'))
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => [f, fs.readFileSync(f, 'utf8')] as const);

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
    ['line-strong', '#8393b8'],
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

  it('--color-subtle reaches 4.5:1 on white (placeholders, struck-out taken slots) and stays lighter than muted', () => {
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const s = parseInt(h.slice(i, i + 2), 16) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    expect(ratio(token('subtle')!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(lum(token('subtle')!)).toBeGreaterThan(lum(token('muted')!));
  });

  it('--color-line-strong (taken slot border, a non-text boundary) reaches 3:1 on white', () => {
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const s = parseInt(h.slice(i, i + 2), 16) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    expect((1.05) / (lum(token('line-strong')!) + 0.05)).toBeGreaterThanOrEqual(3);
  });

  it('WhatsApp green: white text >= 4.5:1 (and on the hover colour), and the bright #25D366 is never used', () => {
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const s = parseInt(h.slice(i, i + 2), 16) / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const onWhite = (h: string) => 1.05 / (lum(h) + 0.05);
    expect(token('whatsapp')).toBe('#12805c');
    expect(onWhite(token('whatsapp')!)).toBeGreaterThanOrEqual(4.5);
    expect(onWhite(token('whatsapp-hover')!)).toBeGreaterThanOrEqual(onWhite(token('whatsapp')!));
    expect(onWhite('#25d366')).toBeLessThan(2); // why it is banned
    const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(cssCode).not.toMatch(/#25d366/i);
    const offenders = sources
      .filter(([, code]) => /#25d366|rgb\(\s*37[ ,]+211[ ,]+102/i.test(code))
      .map(([f]) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });

  it('WhatsApp and Call buttons use their own variants (solid green, outlined Royal Blue; never red)', () => {
    const styles = fs.readFileSync(path.join(root, 'src/components/ui/buttonStyles.ts'), 'utf8');
    expect(/whatsapp: '[^']*\bbg-whatsapp\b[^']*\btext-white\b/.test(styles)).toBe(true);
    const call = /call: '([^']*)'/.exec(styles)?.[1] ?? '';
    expect(call).toMatch(/\bborder-brand\b/);
    expect(call).toMatch(/\btext-brand\b/);
    expect(call).not.toMatch(/danger|red/);
  });

  it('has no legacy --color-accent alias and no accent colour utilities (use cyan)', () => {
    expect(css).not.toMatch(/--color-accent\b/);
    const offenders = sources
      .filter(([, code]) => /\b(bg|text|border|ring|fill|stroke)-accent\b|var\(--color-accent\)/.test(code))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('uses no large or coloured box shadows (neutral, small elevation only)', () => {
    const offenders = sources
      .filter(([, code]) => /rgba?\(\s*(11[ ,_]25|37[ ,_]78)|shadow-\[0_(1[0-9]|[2-9][0-9])px/.test(code))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('every arbitrary shadow-[...] is black-only with a blur under 10 px (file:line listed on failure)', () => {
    const violations: string[] = [];
    const layerSplit = (v: string) => {
      const out: string[] = [];
      let depth = 0;
      let cur = '';
      for (const ch of v) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
          out.push(cur);
          cur = '';
        } else cur += ch;
      }
      out.push(cur);
      return out;
    };
    for (const [file, code] of sources) {
      if (!code.includes('shadow-[')) continue;
      code.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/shadow-\[((?:[^\]\[]|\[[^\]]*\])*)\]/g)) {
          for (const layer of layerSplit(m[1]!)) {
            const parts = layer.replace(/^inset_/, '').match(/^(-?[\d.]+(?:px)?)_(-?[\d.]+(?:px)?)(?:_(-?[\d.]+(?:px)?))?(?:_(-?[\d.]+(?:px)?))?_(.+)$/);
            const where = `${path.relative(root, file)}:${i + 1} ${m[0]}`;
            if (!parts) {
              violations.push(`${where} (unparseable layer)`);
              continue;
            }
            const blur = parts[3] === undefined ? 0 : parseFloat(parts[3]);
            const colour = parts[5]!;
            if (!/^rgb\(0_0_0[/)]/.test(colour)) violations.push(`${where} (colour must be rgb(0_0_0/..), got ${colour})`);
            if (blur >= 10) violations.push(`${where} (blur ${blur}px, max 9)`);
          }
        }
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
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
    const offenders = sources
      .filter(([, code]) => /text-(cyan|turquoise|mint)\b|bg-(cyan|turquoise)\b[^'"`]*text-white|text-white[^'"`]*\bbg-(cyan|turquoise)\b/.test(code))
      .map(([f]) => f);
    expect(offenders).toEqual([]);
  });
});

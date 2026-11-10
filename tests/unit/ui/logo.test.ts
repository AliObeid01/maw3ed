import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { Logo, MIN_FULL_LOGO_WIDTH } from '@/components/brand/Logo';
import manifest from '@/app/manifest';

const root = path.resolve(import.meta.dirname, '../../..');
const html = (props: Parameters<typeof Logo>[0] = {}) => renderToStaticMarkup(createElement(Logo, props));
const attr = (markup: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(markup)?.[1];
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Logo (PR-16b: calendar-M icon, the 3 as two turquoise arcs)', () => {
  it('renders the full logo by default on the light tone: navy wordmark, navy calendar body, blue band', () => {
    const m = html({ width: 160 });
    expect(attr(m, 'data-logo')).toBe('full');
    expect(attr(m, 'data-tone')).toBe('brand');
    expect(m).toContain('viewBox="-8 13 453.53 130.04"');
    expect(m).toContain('<g fill="#0B1938">'); // wordmark
    expect(m).toContain('<rect y="6" width="64" height="58" rx="14" fill="#0B1938"></rect>'); // calendar body, no outline
    expect(m).toContain('fill="#2864F5"');
    expect(m).toContain('stroke="#21CDB3"');
  });

  it('the white tone is the reverse version: white wordmark, lighter body with a faint outline, no navy text', () => {
    const m = html({ width: 160, tone: 'white' });
    expect(attr(m, 'data-tone')).toBe('white');
    expect(m).toContain('<g fill="#FFFFFF">');
    expect(m).not.toContain('<g fill="#0B1938">');
    expect(m).toContain('fill="#16295E"');
    expect(m).toMatch(/stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="1.2"/);
    // The icon geometry is identical to the light version.
    const geometry = (s: string) => s.match(/ d="[^"]+"| x="[^"]+"| rx="[^"]+"| width="[^"]+"/g);
    expect(geometry(html({ width: 160 }))).toEqual(geometry(m));
  });

  it('uses the wordmark under the minimum width, and when asked for it', () => {
    expect(MIN_FULL_LOGO_WIDTH).toBe(96);
    expect(attr(html({ width: MIN_FULL_LOGO_WIDTH - 1 }), 'data-logo')).toBe('wordmark');
    expect(attr(html({ width: MIN_FULL_LOGO_WIDTH }), 'data-logo')).toBe('full');
    const w = html({ width: 200, variant: 'wordmark' });
    expect(attr(w, 'data-logo')).toBe('wordmark');
    expect(w).toContain('viewBox="92 24 340 115"');
    expect(w).not.toContain('rx="14"'); // no calendar
  });

  it('icon variant: the 64 x 64 calendar only, square, even at a small width', () => {
    const m = html({ variant: 'icon', width: 40, label: 'Maw3ed' });
    expect(attr(m, 'data-logo')).toBe('icon');
    expect(m).toContain('viewBox="0 0 64 64"');
    expect(attr(m, 'height')).toBe('40');
    expect(m).not.toContain('translate(94 100.0)'); // no wordmark glyphs
  });

  it('keeps the size contract: height follows the artwork ratio', () => {
    expect(attr(html({ width: 200 }), 'height')).toBe(String(Math.round((200 * 130.04) / 453.53)));
    expect(attr(html({ width: 80 }), 'height')).toBe(String(Math.round((80 * 115) / 340)));
  });

  it('accessible name: role=img + aria-label when a label is given (exactly once), otherwise aria-hidden', () => {
    const named = html({ label: 'Maw3ed home' });
    expect(named).toContain('role="img"');
    expect(named.match(/aria-label=/g)).toHaveLength(1);
    expect(named).not.toContain('aria-hidden');
    const decorative = html();
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role=');
    expect(decorative).not.toContain('aria-label');
    for (const variant of ['full', 'wordmark', 'icon'] as const) {
      expect(html({ variant, width: 120 })).toContain('aria-hidden="true"');
      expect(html({ variant, width: 120, label: 'Maw3ed' })).toContain('role="img"');
    }
  });

  it('is flat artwork only: no gold, text, gradients, filters or font dependence, always left-to-right', () => {
    for (const variant of ['full', 'wordmark', 'icon'] as const) {
      for (const tone of ['brand', 'white'] as const) {
        const m = html({ variant, tone, width: 200 });
        expect(m).not.toMatch(/E8B86D|<text|gradient|filter|<image|font-family/i);
        expect(m).toContain('direction:ltr');
      }
    }
    expect(read('src/components/brand/Logo.tsx')).not.toMatch(/GOLD|E8B86D/i);
  });

  it('the inline paths match the owner file in design/logo (light) and the generated reverse', () => {
    const light = html({ width: 200 });
    const reverse = html({ width: 200, tone: 'white' });
    for (const d of read('design/logo/maw3ed-logo-light.svg').match(/ d="([^"]+)"/g) ?? [])
      expect(light).toContain(d);
    for (const d of read('design/logo/maw3ed-logo-reverse.svg').match(/ d="([^"]+)"/g) ?? [])
      expect(reverse).toContain(d);
    expect(read('design/logo/maw3ed-logo-light.svg')).toContain('viewBox="-8 13 453.53 130.04"');
    expect(read('design/logo/maw3ed-logo-reverse.svg')).toContain('<g fill="#FFFFFF">');
  });

  it('the old logo is gone: no 363.55 viewBox or stacked-arc 3 stroke path in src', () => {
    expect(read('src/components/brand/Logo.tsx')).not.toMatch(/363\.55|M201\.5 32\.5H213\.5/);
  });
});

describe('web app manifest and icon files', () => {
  const m = manifest();
  const png = async (rel: string) => {
    const meta = await sharp(path.join(root, rel)).metadata();
    return `${meta.width}x${meta.height}`;
  };
  it('names the app and starts at the root, standalone', () => {
    expect(m.name).toBe('Maw3ed');
    expect(m.short_name).toBe('Maw3ed');
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#F3F5FA');
    expect(m.background_color).toBe('#F3F5FA');
  });
  it('lists 192, 512 and a maskable 512 that exist in public/ with exactly those dimensions', async () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    for (const i of icons) {
      const rel = path.join('public', i.src.replace(/^\//, ''));
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
      expect(await png(rel)).toBe(i.sizes);
    }
  });
  it('the maskable icon is a solid navy square with the icon inside the 60 % safe zone', async () => {
    const { data, info } = await sharp(path.join(root, 'public/brand/app-icon-maskable-512.png'))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    for (const [x, y] of [[0, 0], [511, 0], [0, 511], [511, 511], [30, 256], [256, 30]] as [number, number][]) expect(px(x, y)).toEqual([11, 25, 56]);
    // Safe zone: the outer 20 % ring is pure background.
    for (let i = 0; i < 512; i += 7) for (const e of [0, 50, 101]) {
      expect(px(i, e)).toEqual([11, 25, 56]);
      expect(px(e, i)).toEqual([11, 25, 56]);
      expect(px(i, 511 - e)).toEqual([11, 25, 56]);
      expect(px(511 - e, i)).toEqual([11, 25, 56]);
    }
  });
  it('has the favicon (16, 32, 48), svg icon and 180 apple icon in src/app', async () => {
    for (const f of ['favicon.ico', 'icon.svg', 'apple-icon.png'])
      expect(fs.existsSync(path.join(root, 'src/app', f)), f).toBe(true);
    expect(await png('src/app/apple-icon.png')).toBe('180x180');
    const ico = fs.readFileSync(path.join(root, 'src/app/favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32, 48]);
    expect(read('src/app/icon.svg')).toBe(read('design/logo/maw3ed-icon.svg'));
    for (const s of [16, 32, 48]) expect(await png(`design/logo/favicon/favicon-${s}.png`)).toBe(`${s}x${s}`);
  });
  it('the email logo files exist for every size, reverse and light, with the logo aspect ratio', async () => {
    for (const tone of ['reverse', 'light'])
      for (const [w, h] of [[160, 46], [320, 92], [480, 138]])
        expect(await png(`public/brand/maw3ed-email-logo-${tone}-${w}w.png`)).toBe(`${w}x${h}`);
  });
});

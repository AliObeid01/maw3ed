import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Logo, MIN_FULL_LOGO_WIDTH } from '@/components/brand/Logo';
import manifest from '@/app/manifest';

const root = path.resolve(import.meta.dirname, '../../..');
const html = (props: Parameters<typeof Logo>[0] = {}) => renderToStaticMarkup(createElement(Logo, props));
const attr = (markup: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(markup)?.[1];

describe('Logo (option B: calendar-M, the 3 as two stacked arcs)', () => {
  it('renders the full logo by default: calendar icon, navy body on the light tone', () => {
    const m = html({ width: 160 });
    expect(attr(m, 'data-logo')).toBe('full');
    expect(attr(m, 'data-tone')).toBe('brand');
    expect(m).toContain('viewBox="-8 13 363.55 98"');
    expect(m).toContain('<rect y="6" width="64" height="58" rx="14" fill="#0B1938">'); // calendar body
    expect(m).toContain('fill="#2864F5"'); // Electric Blue header
    expect(m).toContain('stroke="#21CDB3"'); // turquoise lower arc / V of the M
  });

  it('the white tone is the reverse version (white letters, Royal Blue calendar, no navy text)', () => {
    const m = html({ width: 160, tone: 'white' });
    expect(attr(m, 'data-tone')).toBe('white');
    expect(m).toContain('fill="#254EDB"');
    expect(m).toContain('fill="#43C4F0"');
    expect(m).toContain('stroke="#FFFFFF"');
    expect(m).not.toContain('stroke="#0B1938"');
  });

  it('uses the wordmark under the minimum width, and when asked for it', () => {
    expect(MIN_FULL_LOGO_WIDTH).toBe(96);
    expect(attr(html({ width: MIN_FULL_LOGO_WIDTH - 1 }), 'data-logo')).toBe('wordmark');
    expect(attr(html({ width: MIN_FULL_LOGO_WIDTH }), 'data-logo')).toBe('full');
    const w = html({ width: 200, variant: 'wordmark' });
    expect(attr(w, 'data-logo')).toBe('wordmark');
    expect(w).toContain('viewBox="-8 20 345.55 88"');
    expect(w).not.toContain('rx="14"'); // no calendar
    expect(w).toContain('M4.5 95.5V32.5L34.5 78 64.5 32.5V95.5'); // the written M
  });

  it('keeps the size contract: height follows the artwork ratio', () => {
    const m = html({ width: 200 });
    expect(attr(m, 'width')).toBe('200');
    expect(attr(m, 'height')).toBe(String(Math.round((200 * 98) / 363.55)));
    const wm = html({ width: 80 });
    expect(attr(wm, 'height')).toBe(String(Math.round((80 * 88) / 345.55)));
  });

  it('accessible name: role=img + aria-label when a label is given, otherwise aria-hidden', () => {
    const named = html({ label: 'Maw3ed home' });
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Maw3ed home"');
    expect(named).not.toContain('aria-hidden');
    const decorative = html();
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain('role=');
    expect(decorative).not.toContain('aria-label');
    for (const variant of ['full', 'wordmark'] as const) {
      expect(html({ variant, width: 120 })).toContain('aria-hidden="true"');
      expect(html({ variant, width: 120, label: 'x' })).toContain('role="img"');
    }
  });

  it('is flat artwork only: no gold, text, gradients, filters or font dependence, always left-to-right', () => {
    for (const variant of ['full', 'wordmark'] as const) {
      for (const tone of ['brand', 'white'] as const) {
        const m = html({ variant, tone, width: 200 });
        expect(m).not.toMatch(/E8B86D|<text|gradient|filter|<image|font-family/i);
        expect(m).toContain('direction:ltr');
      }
    }
    const source = fs.readFileSync(path.join(root, 'src/components/brand/Logo.tsx'), 'utf8');
    expect(source).not.toMatch(/GOLD|E8B86D/i);
  });

  it('the inline paths match the owner files in design/logo', () => {
    const light = fs.readFileSync(path.join(root, 'design/logo/1-platform/maw3ed-logo-light.svg'), 'utf8');
    const m = html({ width: 200 });
    // Every `d` of the source file is in the component output.
    for (const d of light.match(/ d="([^"]+)"/g) ?? []) expect(m).toContain(d.replace(/^ d=/, 'd='));
  });
});

describe('web app manifest and icon files', () => {
  const m = manifest();
  it('names the app and starts at the root, standalone', () => {
    expect(m.name).toBe('Maw3ed');
    expect(m.short_name).toBe('Maw3ed');
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toBe('#F3F5FA');
    expect(m.background_color).toBe('#F3F5FA');
  });
  it('lists 192, 512 and a maskable 512 that exist in public/', () => {
    const icons = m.icons ?? [];
    expect(icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '512x512:maskable']);
    for (const i of icons) expect(fs.existsSync(path.join(root, 'public', i.src.replace(/^\//, '')))).toBe(true);
  });
  it('has the favicon, svg icon and apple icon in src/app (Next serves them and adds the <head> links)', () => {
    for (const f of ['favicon.ico', 'icon.svg', 'apple-icon.png'])
      expect(fs.existsSync(path.join(root, 'src/app', f)), f).toBe(true);
    // The no-band favicon variant (16 px legibility) is the one used.
    expect(fs.readFileSync(path.join(root, 'src/app/icon.svg'), 'utf8')).toBe(
      fs.readFileSync(path.join(root, 'design/logo/4-favicon/alternative-no-band/favicon.svg'), 'utf8'),
    );
  });
  it('the email logo files exist for every size, reverse and light', () => {
    for (const tone of ['reverse', 'light'])
      for (const w of [160, 320, 480])
        expect(fs.existsSync(path.join(root, `public/brand/maw3ed-email-logo-${tone}-${w}w.png`))).toBe(true);
  });
});

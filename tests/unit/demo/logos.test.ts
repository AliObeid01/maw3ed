import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { generateLogo, monogramOf, monogramSvg } from '../../../scripts/demo/logos';
import { MANIFEST } from '../../../scripts/demo/manifest';

describe('demo logos', () => {
  it('derives a two letter monogram from the first two words', () => {
    expect(monogramOf('Cedar Smile Dental Clinic')).toBe('CS');
    expect(monogramOf('Levant Physio and Rehab')).toBe('LP');
    expect(monogramOf('Pearl')).toHaveLength(2);
  });

  it('draws shapes only: no text, no external references', () => {
    const svg = monogramSvg('Cedar Barber Lounge', 1);
    expect(svg).not.toMatch(/<text|<image|href|font/i);
    expect(svg).toMatch(/^<svg /);
  });

  it('stores what the upload pipeline would: 256x256 WebP, 64-char hash, small, distinct per business', async () => {
    const logoBusinesses = MANIFEST.filter((b) => b.logo);
    const hashes = new Set<string>();
    for (const [i, b] of logoBusinesses.entries()) {
      const logo = await generateLogo(b.name, i);
      expect(logo.mime).toBe('image/webp');
      expect(logo.width).toBe(256);
      expect(logo.height).toBe(256);
      expect(logo.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(logo.bytes.length).toBeLessThanOrEqual(150 * 1024);
      const meta = await sharp(logo.bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(256);
      expect(meta.height).toBe(256);
      expect(meta.exif).toBeUndefined();
      hashes.add(logo.hash);
    }
    expect(hashes.size).toBe(logoBusinesses.length);
  });

  it('is deterministic', async () => {
    const a = await generateLogo('Skyline Hair Studio', 3);
    const b = await generateLogo('Skyline Hair Studio', 3);
    expect(a.hash).toBe(b.hash);
  });
});

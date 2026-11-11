import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { LOGO_MAX_STORED_BYTES, processLogo } from '../../../src/server/services/logoImage';
import { generateLogo, logoDesignFor, logoSvg, monogramOf, monogramPng } from '../../../scripts/demo/logos';
import { MANIFEST } from '../../../scripts/demo/manifest';

/** All 18 businesses get a designed mark available (only some are stored: `logo: true`). */
const ALL = MANIFEST.map((b, i) => ({ name: b.name, variant: i }));

describe('demo logos', () => {
  it('derives a two letter monogram from the first two words', () => {
    expect(monogramOf('Cedar Smile Dental Clinic')).toBe('CS');
    expect(monogramOf('Levant Physio and Rehab')).toBe('LP');
    expect(monogramOf('Pearl')).toHaveLength(2);
  });

  it('draws vector shapes only: no text, no images, no external references, no fonts', () => {
    for (const { name, variant } of ALL) {
      const svg = logoSvg(name, variant);
      expect(svg).toMatch(/^<svg /);
      expect(svg).not.toMatch(/<text|<image|href|font|<use|<script|url\(http/i);
    }
  });

  it('is deterministic: same name and variant, same bytes', async () => {
    for (const { name, variant } of ALL.slice(0, 6)) {
      const a = await generateLogo(name, variant);
      const b = await generateLogo(name, variant);
      expect(a.hash).toBe(b.hash);
      expect(logoSvg(name, variant)).toBe(logoSvg(name, variant));
    }
  });

  it('stores what the upload pipeline would for every logo business: 256x256 WebP within the size limit', async () => {
    const logoBusinesses = MANIFEST.filter((b) => b.logo);
    expect(logoBusinesses.length).toBeGreaterThan(0);
    for (const [i, b] of logoBusinesses.entries()) {
      const logo = await generateLogo(b.name, i);
      expect(logo.mime).toBe('image/webp');
      expect(logo.width).toBe(256);
      expect(logo.height).toBe(256);
      expect(logo.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(logo.bytes.length).toBeLessThanOrEqual(LOGO_MAX_STORED_BYTES);
      const meta = await sharp(logo.bytes).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(256);
      expect(meta.height).toBe(256);
      expect(meta.exif).toBeUndefined();
    }
  });

  it('goes through processLogo without error for all 18 designs', async () => {
    for (const { name, variant } of ALL) {
      const out = await processLogo(await monogramPng(name, variant));
      expect(out.bytes.length).toBeGreaterThan(0);
      expect(out.bytes.length).toBeLessThanOrEqual(LOGO_MAX_STORED_BYTES);
    }
  });

  it('gives all 18 businesses clearly different logos (hash, and motif/layout/palette)', async () => {
    const hashes = new Set<string>();
    const svgs = new Set<string>();
    const triples = new Set<string>();
    const motifs = new Set<string>();
    const palettes = new Set<string>();
    for (const { name, variant } of ALL) {
      hashes.add((await generateLogo(name, variant)).hash);
      svgs.add(createHash('sha256').update(logoSvg(name, variant)).digest('hex'));
      const d = logoDesignFor(name, variant);
      triples.add(`${d.motif}|${d.layout}|${d.palette}`);
      motifs.add(`${d.family}/${d.motif}`);
      palettes.add(d.palette);
    }
    expect(hashes.size).toBe(18);
    expect(svgs.size).toBe(18);
    expect(triples.size).toBe(18);
    expect(motifs.size).toBe(18);
    expect(palettes.size).toBe(18);
  });

  it('matches the category family, and uses at least 4 layouts', () => {
    const families: Record<string, string> = {
      barbers: 'barbers',
      'hair-salons': 'hair',
      'dental-clinics': 'dental',
      'beauty-clinics': 'beauty',
      'spa-massage': 'spa',
      physiotherapy: 'physio',
    };
    const layouts = new Set<string>();
    MANIFEST.forEach((b, i) => {
      const d = logoDesignFor(b.name, i);
      expect(d.family).toBe(families[b.category]);
      layouts.add(d.layout);
    });
    expect(layouts.size).toBeGreaterThanOrEqual(4);
  });
});

import sharp from 'sharp';
import { processLogo, type ProcessedLogo } from '../../src/server/services/logoImage';

/**
 * Generated logos: original geometric monograms (two block letters built from rounded squares on a plain colour
 * field) in the Maw3ed brand palette. No photos, no real people, no real brands, and NO text rendering (so the
 * result does not depend on any font installed on the machine). The SVG is turned into a PNG with sharp and then
 * handed to the SAME function the app uses for logo uploads (`processLogo`: 256x256 WebP, metadata stripped,
 * sha256 hash), so the stored row is exactly what an upload would have produced.
 */

export const PALETTE = {
  navy: '#0B1938',
  blue: '#2864F5',
  turquoise: '#21CDB3',
  cyan: '#43C4F0',
  royal: '#254EDB',
  mint: '#B8F2E6',
} as const;

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '01010', '00100', '00100', '00100', '01010', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
};

interface Scheme {
  field: string;
  accent: string;
  ink: string;
}
const SCHEMES: Scheme[] = [
  { field: PALETTE.navy, accent: PALETTE.blue, ink: '#FFFFFF' },
  { field: PALETTE.blue, accent: PALETTE.cyan, ink: '#FFFFFF' },
  { field: PALETTE.turquoise, accent: PALETTE.mint, ink: PALETTE.navy },
  { field: PALETTE.royal, accent: PALETTE.turquoise, ink: '#FFFFFF' },
  { field: PALETTE.cyan, accent: PALETTE.navy, ink: PALETTE.navy },
];

/** The two initials of the first two words of a business name ("Cedar Smile Dental Clinic" -> "CS"). */
export function monogramOf(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return letters.length === 2 ? letters : (words[0] ?? 'M').slice(0, 2).toUpperCase().padEnd(2, 'M');
}

/** A 512x512 SVG monogram. `variant` picks the colour scheme and a decorative shape. Pure. */
export function monogramSvg(name: string, variant: number): string {
  const scheme = SCHEMES[variant % SCHEMES.length]!;
  const letters = monogramOf(name).split('');
  const cell = 28;
  const gap = cell * 1.6;
  const glyphW = 5 * cell;
  const totalW = letters.length * glyphW + (letters.length - 1) * gap;
  const totalH = 7 * cell;
  const x0 = (512 - totalW) / 2;
  const y0 = (512 - totalH) / 2 + 6;
  const rects: string[] = [];
  letters.forEach((ch, li) => {
    const rows = GLYPHS[ch] ?? GLYPHS.M!;
    rows.forEach((row, r) =>
      [...row].forEach((bit, c) => {
        if (bit !== '1') return;
        const x = x0 + li * (glyphW + gap) + c * cell;
        const y = y0 + r * cell;
        rects.push(
          `<rect x="${x + 1.5}" y="${y + 1.5}" width="${cell - 3}" height="${cell - 3}" rx="6" fill="${scheme.ink}"/>`,
        );
      }),
    );
  });
  const shape =
    variant % 3 === 0
      ? `<circle cx="420" cy="92" r="110" fill="${scheme.accent}" opacity="0.55"/>`
      : variant % 3 === 1
        ? `<rect x="-60" y="360" width="360" height="360" rx="90" transform="rotate(-18 120 540)" fill="${scheme.accent}" opacity="0.5"/>`
        : `<polygon points="512,0 512,230 282,0" fill="${scheme.accent}" opacity="0.6"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="${scheme.field}"/>${shape}${rects.join('')}</svg>`
  );
}

/** The SVG rasterised to PNG: the "upload" the pipeline receives. */
export async function monogramPng(name: string, variant: number): Promise<Buffer> {
  return sharp(Buffer.from(monogramSvg(name, variant))).png().toBuffer();
}

/** Business name -> the stored logo, through the app's own image pipeline. */
export async function generateLogo(name: string, variant: number): Promise<ProcessedLogo> {
  return processLogo(await monogramPng(name, variant));
}

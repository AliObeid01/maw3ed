import sharp from 'sharp';
import { processLogo, type ProcessedLogo } from '../../src/server/services/logoImage';

/**
 * Generated logos: ORIGINAL vector marks drawn as SVG strings in code. Six motif families match the app's
 * categories (3 drawings each), five layout treatments (circle badge with ring, app-icon, shield crest, flat emblem
 * on tint, monogram plus symbol) and 18 hand-picked 3-colour palettes, so all 18 demo businesses look different.
 * No photos, no real people, no real brands, and NO <text> (initials, where used, are drawn as shapes), so the
 * result does not depend on any font installed on the machine. The SVG is rasterised to PNG with sharp and then
 * handed to the SAME function the app uses for logo uploads (`processLogo`: 256x256 WebP, metadata stripped,
 * sha256 hash), so the stored row is exactly what an upload would have produced. Pure and deterministic.
 */

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

// ---------------------------------------------------------------------------------------------------------------
// Palettes: dark (deep ink), main (mid tone), tint (light field), accent (small highlight).
// ---------------------------------------------------------------------------------------------------------------
interface Palette {
  dark: string;
  main: string;
  tint: string;
  accent: string;
}
const PALETTES = {
  forest: { dark: '#17402F', main: '#2F7D5B', tint: '#E6F1E6', accent: '#E3B448' },
  charcoal: { dark: '#1F2328', main: '#3C4650', tint: '#EEF0F2', accent: '#F2B84B' },
  burgundy: { dark: '#5A1424', main: '#A23049', tint: '#FBEBEC', accent: '#E7B766' },
  'sky-orange': { dark: '#1B4B73', main: '#3E8EDB', tint: '#E8F3FC', accent: '#FF8F5A' },
  rose: { dark: '#5C3040', main: '#C26A85', tint: '#FCEBF0', accent: '#F3C97A' },
  teal: { dark: '#0B4F55', main: '#1A9AA0', tint: '#E1F5F3', accent: '#F4C36B' },
  ocean: { dark: '#0D3B66', main: '#1F78C8', tint: '#E3F1FC', accent: '#57D0C0' },
  'gold-cream': { dark: '#2A2724', main: '#B8893A', tint: '#FBF3DF', accent: '#D9B45E' },
  emerald: { dark: '#0A4D3C', main: '#1FAF8A', tint: '#E0F8EF', accent: '#F5D26B' },
  plum: { dark: '#3E1F47', main: '#7B3F8C', tint: '#F3E8F6', accent: '#F0A6B8' },
  midnight: { dark: '#0F1E3D', main: '#2F4C8F', tint: '#E8EEF9', accent: '#E8B84A' },
  coral: { dark: '#8E2B2A', main: '#F06B5B', tint: '#FFF0EC', accent: '#FFB4A2' },
  sage: { dark: '#3C5846', main: '#86A88F', tint: '#EEF4EA', accent: '#D98F6C' },
  lavender: { dark: '#2F2E5C', main: '#6E6CC4', tint: '#ECEBFA', accent: '#F2A7C3' },
  olive: { dark: '#4A4B1F', main: '#8C8E2F', tint: '#F6F4D8', accent: '#E48A2F' },
  sand: { dark: '#4B3425', main: '#A47148', tint: '#F7EDE0', accent: '#5FA39A' },
  graphite: { dark: '#22262A', main: '#5B6770', tint: '#F0F2F0', accent: '#A6D854' },
  terracotta: { dark: '#7A2E1D', main: '#C4553A', tint: '#F8E9DF', accent: '#E9A25B' },
} as const satisfies Record<string, Palette>;
type PaletteName = keyof typeof PALETTES;

// ---------------------------------------------------------------------------------------------------------------
// Motifs: drawn in a 100x100 box. p = primary colour, a = accent, c = cut-out colour (the colour behind the mark).
// ---------------------------------------------------------------------------------------------------------------
type Family = 'barbers' | 'hair' | 'dental' | 'beauty' | 'spa' | 'physio';
type Draw = (p: string, a: string, c: string) => string;

const sparkle = (cx: number, cy: number, r: number, fill: string) =>
  `<path d="M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z" fill="${fill}"/>`;
const stroke = (d: string, color: string, w: number) =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const TOOTH =
  'M30 22C40 14 46 24 50 24C54 24 60 14 70 22C82 30 78 52 72 64C69 76 68 90 61 90C55 90 56 72 50 72C44 72 45 90 39 90C32 90 31 76 28 64C22 52 18 30 30 22Z';

const MOTIFS: Record<Family, Draw[]> = {
  barbers: [
    // 0 barber pole
    (p, a, c) =>
      `<defs><clipPath id="mc"><rect x="35" y="20" width="30" height="60" rx="4"/></clipPath></defs>` +
      `<rect x="35" y="20" width="30" height="60" rx="4" fill="${c}"/>` +
      `<g clip-path="url(#mc)">${[0, 1, 2, 3, 4]
        .map((k) => {
          const y = 6 + k * 18;
          return `<polygon points="30,${y + 16} 70,${y - 4} 70,${y + 8} 30,${y + 28}" fill="${k % 2 ? a : p}"/>`;
        })
        .join('')}</g>` +
      `<rect x="35" y="20" width="30" height="60" rx="4" fill="none" stroke="${p}" stroke-width="4"/>` +
      `<rect x="30" y="10" width="40" height="12" rx="6" fill="${p}"/><rect x="30" y="78" width="40" height="12" rx="6" fill="${p}"/>` +
      `<circle cx="50" cy="8" r="5" fill="${a}"/>`,
    // 1 razor
    (p, a, c) =>
      `<g transform="rotate(-12 50 50)">` +
      `<path d="M6 34H66V54H16Q6 54 6 44Z" fill="${p}"/>` +
      `<rect x="6" y="34" width="60" height="6" rx="3" fill="${a}"/>` +
      `<rect x="58" y="44" width="40" height="16" rx="8" fill="${a}" transform="rotate(38 64 52)"/>` +
      `<circle cx="64" cy="48" r="7" fill="${p}"/><circle cx="64" cy="48" r="2.8" fill="${c}"/></g>` +
      sparkle(80, 18, 11, a),
    // 2 comb
    (p, a, c) =>
      `<rect x="10" y="24" width="80" height="24" rx="10" fill="${p}"/>` +
      [0, 1, 2, 3, 4, 5, 6, 7, 8]
        .map((i) => `<rect x="${13 + i * 8.3}" y="42" width="5.2" height="34" rx="2.6" fill="${p}"/>`)
        .join('') +
      `<rect x="20" y="32" width="38" height="5" rx="2.5" fill="${c}" opacity="0.8"/>` +
      `<circle cx="74" cy="34.5" r="4" fill="${a}"/>` +
      sparkle(80, 86, 9, a),
  ],
  hair: [
    // 0 scissors
    (p, a, c) =>
      stroke('M30 10L66 70', p, 8) +
      stroke('M70 10L34 70', p, 8) +
      `<circle cx="66" cy="80" r="11" fill="none" stroke="${a}" stroke-width="7"/>` +
      `<circle cx="34" cy="80" r="11" fill="none" stroke="${a}" stroke-width="7"/>` +
      `<circle cx="50" cy="40" r="5" fill="${c}" stroke="${p}" stroke-width="3"/>`,
    // 1 hair swoosh
    (p, a) =>
      stroke('M22 90C0 60 24 40 38 24C44 16 46 10 46 6', p, 9) +
      stroke('M44 92C26 62 52 44 64 28C70 20 72 14 70 8', a, 9) +
      stroke('M66 92C54 70 74 54 82 42C86 36 88 30 88 26', p, 9),
    // 2 hand mirror
    (p, a, c) =>
      `<ellipse cx="50" cy="38" rx="28" ry="32" fill="${a}" fill-opacity="0.35" stroke="${p}" stroke-width="8"/>` +
      `<rect x="44" y="68" width="12" height="24" rx="6" fill="${p}"/>` +
      sparkle(40, 30, 11, c) +
      sparkle(60, 50, 6, c),
  ],
  dental: [
    // 0 tooth with sparkle
    (p, a, c) =>
      `<path d="${TOOTH}" fill="${p}"/>` +
      stroke('M32 34C32 30 35 28 38 29', c, 4) +
      sparkle(80, 20, 14, a) +
      sparkle(22, 14, 7, a),
    // 1 tooth with leaf
    (p, a, c) =>
      `<path d="${TOOTH}" transform="translate(0 6)" fill="${p}"/>` +
      `<path d="M50 24C48 6 64 2 76 6C78 20 66 30 50 24Z" fill="${a}"/>` +
      stroke('M52 22C58 16 64 12 70 10', c, 2.4),
    // 2 smile
    (p, a, c) =>
      `<path d="M8 36C30 28 70 28 92 36C88 66 70 84 50 84C30 84 12 66 8 36Z" fill="${p}"/>` +
      `<path d="M18 42C36 38 64 38 82 42C78 60 66 72 50 72C34 72 22 60 18 42Z" fill="${c}"/>` +
      stroke('M50 40V70', p, 3) +
      stroke('M34 40V66M66 40V66', p, 3) +
      sparkle(86, 16, 10, a) +
      sparkle(14, 18, 6, a),
  ],
  beauty: [
    // 0 sparkle
    (p, a) => sparkle(46, 54, 40, p) + sparkle(80, 20, 15, a) + sparkle(78, 82, 9, a) + sparkle(16, 16, 6, a),
    // 1 drop
    (p, a, c) =>
      `<path d="M50 8C50 8 20 42 20 62A30 30 0 0 0 80 62C80 42 50 8 50 8Z" fill="${p}"/>` +
      stroke('M34 62A16 16 0 0 0 46 78', c, 5) +
      sparkle(80, 24, 13, a) +
      sparkle(20, 24, 6, a),
    // 2 face profile line
    (p, a) =>
      stroke('M32 8C60 6 68 28 64 40L74 54L64 58C66 64 62 68 60 70C64 76 60 84 52 84L50 94', p, 5) +
      stroke('M32 8C20 24 22 56 36 70C42 78 46 82 50 94', p, 5) +
      sparkle(80, 22, 11, a) +
      `<circle cx="52" cy="36" r="3.4" fill="${a}"/>`,
  ],
  spa: [
    // 0 lotus
    (p, a) =>
      `<path d="M50 82C22 82 6 64 6 40C30 42 46 58 50 82Z" fill="${p}" fill-opacity="0.55"/>` +
      `<path d="M50 82C78 82 94 64 94 40C70 42 54 58 50 82Z" fill="${p}" fill-opacity="0.55"/>` +
      `<path d="M50 82C26 74 18 48 26 24C42 36 50 56 50 82Z" fill="${a}"/>` +
      `<path d="M50 82C74 74 82 48 74 24C58 36 50 56 50 82Z" fill="${a}"/>` +
      `<path d="M50 10C66 32 66 62 50 84C34 62 34 32 50 10Z" fill="${p}"/>` +
      stroke('M18 92Q50 100 82 92', a, 5),
    // 1 stacked stones
    (p, a, c) =>
      `<ellipse cx="50" cy="78" rx="36" ry="13" fill="${p}"/>` +
      `<ellipse cx="52" cy="56" rx="26" ry="11" fill="${a}"/>` +
      `<ellipse cx="49" cy="37" rx="17" ry="9" fill="${p}"/>` +
      stroke('M32 72Q40 75 48 74', c, 3) +
      `<circle cx="50" cy="18" r="5" fill="${a}"/>`,
    // 2 leaf
    (p, a, c) =>
      `<path d="M16 84C8 42 36 14 86 14C90 58 62 90 16 84Z" fill="${p}"/>` +
      stroke('M18 82C38 60 56 42 76 26', c, 4) +
      stroke('M44 56C50 58 56 62 58 68', c, 3) +
      stroke('M56 42C62 44 68 48 70 54', c, 3) +
      `<circle cx="82" cy="84" r="6" fill="${a}"/>`,
  ],
  physio: [
    // 0 figure in motion
    (p, a) =>
      `<circle cx="62" cy="16" r="9" fill="${a}"/>` +
      stroke('M56 32L44 58', p, 9) +
      stroke('M44 58L62 70L54 90', p, 9) +
      stroke('M44 58L28 72L14 68', p, 9) +
      stroke('M54 38L72 50L84 42', p, 9) +
      stroke('M54 38L36 44', p, 9) +
      stroke('M6 32H22M2 46H16', a, 4),
    // 1 spine
    (p, a) =>
      stroke('M46 6C34 28 66 46 52 94', a, 3) +
      [
        [41, 6, 22],
        [36, 22, 26],
        [38, 38, 28],
        [44, 54, 28],
        [50, 70, 24],
        [52, 86, 16],
      ]
        .map(([x, y, w], i) => `<rect x="${x}" y="${y! - 2}" width="${w}" height="12" rx="6" fill="${i === 2 || i === 3 ? a : p}"/>`)
        .join('') +
      sparkle(82, 26, 10, a),
    // 2 joint (elbow)
    (p, a, c) =>
      stroke('M24 12L42 50', p, 16) +
      stroke('M58 56L90 74', p, 16) +
      `<circle cx="50" cy="52" r="15" fill="${a}"/><circle cx="50" cy="52" r="5.5" fill="${c}"/>` +
      stroke('M60 18A38 38 0 0 1 86 44', a, 5) +
      stroke('M68 8L60 18L72 22', a, 5),
  ],
};

// ---------------------------------------------------------------------------------------------------------------
// Layouts (512 x 512). Each places the motif and decides the colours it is drawn in.
// ---------------------------------------------------------------------------------------------------------------
type LayoutName = 'circle-badge' | 'app-icon' | 'shield-crest' | 'flat-emblem' | 'monogram-symbol';

function place(motif: string, size: number, cx: number, cy: number): string {
  const s = size / 100;
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${s})">${motif}</g>`;
}

function initialsShape(name: string, color: string): string {
  const cell = 10;
  const letters = monogramOf(name).split('');
  const glyphW = 5 * cell;
  const gap = cell * 1.6;
  const totalW = letters.length * glyphW + (letters.length - 1) * gap;
  const x0 = (512 - totalW) / 2;
  const y0 = 403 - (7 * cell) / 2;
  const rects: string[] = [];
  letters.forEach((ch, li) => {
    (GLYPHS[ch] ?? GLYPHS.M!).forEach((row, r) =>
      [...row].forEach((bit, c) => {
        if (bit !== '1') return;
        rects.push(
          `<rect x="${x0 + li * (glyphW + gap) + c * cell}" y="${y0 + r * cell}" width="${cell + 0.3}" height="${cell + 0.3}" rx="1" fill="${color}"/>`,
        );
      }),
    );
  });
  return rects.join('');
}

function composeLayout(layout: LayoutName, family: Family, motifIndex: number, pal: Palette, name: string): string {
  const draw = MOTIFS[family][motifIndex]!;
  switch (layout) {
    case 'circle-badge':
      return (
        `<rect width="512" height="512" fill="${pal.tint}"/>` +
        `<circle cx="256" cy="256" r="236" fill="${pal.dark}"/>` +
        `<circle cx="256" cy="256" r="206" fill="none" stroke="${pal.accent}" stroke-width="7"/>` +
        `<circle cx="256" cy="256" r="190" fill="none" stroke="${pal.main}" stroke-width="3"/>` +
        place(draw(pal.tint, pal.accent, pal.dark), 250, 256, 256)
      );
    case 'app-icon':
      return (
        `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pal.main}"/><stop offset="1" stop-color="${pal.dark}"/></linearGradient></defs>` +
        `<rect width="512" height="512" fill="${pal.tint}"/>` +
        `<rect x="36" y="36" width="440" height="440" rx="112" fill="url(#g)"/>` +
        `<rect x="36" y="36" width="440" height="220" rx="112" fill="#fff" opacity="0.07"/>` +
        place(draw('#FFFFFF', pal.accent, pal.main), 270, 256, 256)
      );
    case 'shield-crest': {
      const shield = 'M256 34L452 98V262C452 380 362 450 256 484C150 450 60 380 60 262V98Z';
      return (
        `<rect width="512" height="512" fill="${pal.tint}"/>` +
        `<path d="${shield}" fill="${pal.dark}"/>` +
        `<path d="M256 62L426 116V262C426 362 350 424 256 454C162 424 86 362 86 262V116Z" fill="none" stroke="${pal.accent}" stroke-width="6"/>` +
        place(draw(pal.tint, pal.accent, pal.dark), 232, 256, 262)
      );
    }
    case 'flat-emblem':
      return (
        `<rect width="512" height="512" fill="${pal.tint}"/>` +
        `<circle cx="256" cy="256" r="196" fill="${pal.main}" opacity="0.16"/>` +
        place(draw(pal.dark, pal.main === pal.accent ? pal.dark : pal.accent, pal.tint), 330, 256, 256)
      );
    case 'monogram-symbol':
      return (
        `<rect width="512" height="512" fill="${pal.main}"/>` +
        `<circle cx="256" cy="216" r="156" fill="${pal.tint}"/>` +
        `<circle cx="256" cy="216" r="156" fill="none" stroke="${pal.dark}" stroke-width="6" opacity="0.2"/>` +
        place(draw(pal.dark, pal.accent, pal.tint), 210, 256, 216) +
        `<rect x="146" y="356" width="220" height="94" rx="47" fill="${pal.dark}"/>` +
        initialsShape(name, pal.tint)
      );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The 18 designs, one per demo business (looked up by name; unknown names fall back to `variant`).
// ---------------------------------------------------------------------------------------------------------------
export interface LogoDesign {
  family: Family;
  /** Index of the motif drawing inside its family (0 to 2). */
  motif: number;
  layout: LayoutName;
  palette: PaletteName;
}

const d = (family: Family, motif: number, layout: LayoutName, palette: PaletteName): LogoDesign => ({
  family,
  motif,
  layout,
  palette,
});

export const MOTIF_NAMES: Record<Family, string[]> = {
  barbers: ['barber pole', 'razor', 'comb'],
  hair: ['scissors', 'hair swoosh', 'hand mirror'],
  dental: ['tooth and sparkle', 'tooth and leaf', 'smile'],
  beauty: ['sparkle', 'drop', 'face profile'],
  spa: ['lotus', 'stacked stones', 'leaf'],
  physio: ['figure in motion', 'spine', 'joint'],
};

export const LOGO_DESIGNS: Record<string, LogoDesign> = {
  'Cedar Barber Lounge': d('barbers', 0, 'shield-crest', 'forest'),
  'Olive Branch Barbers': d('barbers', 1, 'app-icon', 'charcoal'),
  'Phoenician Gents Barbershop': d('barbers', 2, 'circle-badge', 'burgundy'),
  'Skyline Hair Studio': d('hair', 0, 'app-icon', 'sky-orange'),
  'Levant Hair Atelier': d('hair', 2, 'flat-emblem', 'rose'),
  'Mediterranean Hair Lounge': d('hair', 1, 'monogram-symbol', 'teal'),
  'Cedar Smile Dental Clinic': d('dental', 0, 'circle-badge', 'ocean'),
  'Phoenician Dental Studio': d('dental', 2, 'flat-emblem', 'gold-cream'),
  'Levant Family Dentistry': d('dental', 1, 'shield-crest', 'emerald'),
  'Pearl Skin Clinic': d('beauty', 0, 'monogram-symbol', 'plum'),
  'Blue Wave Aesthetic Center': d('beauty', 1, 'app-icon', 'midnight'),
  'Jasmine Beauty Clinic': d('beauty', 2, 'circle-badge', 'coral'),
  'Serenity Cedar Spa': d('spa', 0, 'flat-emblem', 'sage'),
  'Blue Harbour Massage Studio': d('spa', 1, 'shield-crest', 'lavender'),
  'Olive Grove Wellness Spa': d('spa', 2, 'monogram-symbol', 'olive'),
  'Levant Physio and Rehab': d('physio', 0, 'circle-badge', 'sand'),
  'Cedar Motion Physiotherapy': d('physio', 1, 'flat-emblem', 'graphite'),
  'Phoenician Recovery Center': d('physio', 2, 'app-icon', 'terracotta'),
};
const DESIGN_LIST = Object.values(LOGO_DESIGNS);

/** The design for a business. Unknown names (tests, future businesses) use `variant` so output stays deterministic. */
export function logoDesignFor(name: string, variant: number): LogoDesign {
  return LOGO_DESIGNS[name] ?? DESIGN_LIST[Math.abs(Math.trunc(variant)) % DESIGN_LIST.length]!;
}

/** A 512x512 SVG logo. Pure. */
export function logoSvg(name: string, variant: number): string {
  const design = logoDesignFor(name, variant);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    composeLayout(design.layout, design.family, design.motif, PALETTES[design.palette], name) +
    `</svg>`
  );
}

/** The SVG rasterised to PNG: the "upload" the pipeline receives. */
export async function monogramPng(name: string, variant: number): Promise<Buffer> {
  return sharp(Buffer.from(logoSvg(name, variant))).png().toBuffer();
}

/** Business name -> the stored logo, through the app's own image pipeline. */
export async function generateLogo(name: string, variant: number): Promise<ProcessedLogo> {
  return processLogo(await monogramPng(name, variant));
}

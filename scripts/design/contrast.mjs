#!/usr/bin/env node
// WCAG 2.x contrast check for every text/background pair our components use.
// Reads the colour tokens from src/app/globals.css so it never drifts from the theme.
// Usage: node scripts/design/contrast.mjs   (exit 1 when a text pair fails)
// Thresholds: 4.5:1 for normal text, 3:1 for large text (>= 24 px, or >= 18.66 px bold).
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/app/globals.css'), 'utf8');
const tokens = Object.fromEntries(
  [...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]),
);
const hex = (name) => {
  const v = tokens[name] ?? name;
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`Unknown colour ${name}`);
  return v;
};

const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (h) => {
  const [r, g, b] = toRgb(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Hero band: flat navy (see `bg-hero` in globals.css), no gradient. The 4 px Royal Blue edge is decorative.
const heroStops = { 'hero navy': hex('navy') };

// [label, foreground, background, px, bold]
const pairs = [
  ['ink on canvas', 'ink', 'canvas', 15],
  ['ink on surface', 'ink', 'surface', 15],
  ['muted on canvas', 'muted', 'canvas', 14],
  ['muted on surface', 'muted', 'surface', 14],
  ['muted on divider (neutral chip, full-day pill)', 'muted', 'divider', 12, true],
  ['muted on brand-soft', 'muted', 'brand-soft', 14],
  ['ink on divider (chip)', 'ink', 'divider', 12, true],
  ['brand on surface (link, ghost button)', 'brand', 'surface', 15],
  ['brand on canvas (link on page)', 'brand', 'canvas', 15],
  ['brand on divider (link on mist)', 'brand', 'divider', 15],
  ['brand on brand-soft (active nav, chip)', 'brand', 'brand-soft', 15],
  ['brand-deep on brand-soft (callout)', 'brand-deep', 'brand-soft', 14],
  ['white on brand (primary button, finished step)', '#ffffff', 'brand', 15, true],
  ['white on brand-hover (pressed)', '#ffffff', 'brand-hover', 15, true],
  ['white on electric (selected day, accent button)', '#ffffff', 'electric', 15, true],
  ['white on ink (selected time, current step)', '#ffffff', 'ink', 15, true],
  ['ink on cyan (info chip, initials tile)', 'ink', 'cyan', 12, true],
  ['ink on turquoise (refilled tile)', 'ink', 'turquoise', 14],
  ['success on success-soft (chip)', 'success', 'success-soft', 12, true],
  ['success-deep on success-soft', 'success-deep', 'success-soft', 14],
  ['warning on warning-soft (chip, amber badge)', 'warning', 'warning-soft', 12, true],
  ['warning-deep on warning-soft (callout)', 'warning-deep', 'warning-soft', 14],
  ['danger on danger-soft (chip)', 'danger', 'danger-soft', 12, true],
  ['danger on surface (error text, no-show badge)', 'danger', 'surface', 13, true],
  ['white on danger (red count badge)', '#ffffff', 'danger', 12, true],
  ['amber on amber-soft (chip)', 'amber', 'amber-soft', 12, true],
  ['amber on canvas (stat number)', 'amber', 'canvas', 28, true],
  ['amber on surface (stat number)', 'amber', 'surface', 28, true],
  ['success on surface (stat number)', 'success', 'surface', 28, true],
];
for (const [name, bg] of Object.entries(heroStops)) {
  for (const [label, fg] of [
    ['white', '#ffffff'],
    ['hero-ink', hex('hero-ink')],
    ['hero-muted', hex('hero-muted')],
    ['hero-subtle', hex('hero-subtle')],
    ['cyan (logo, chip edge)', hex('cyan')],
  ]) {
    pairs.push([`${label} on ${name}`, fg, bg, 14, false]);
  }
  pairs.push([`ink on cyan chip over ${name} (status chip)`, 'ink', 'cyan', 13, true]);
}
// `subtle` is for placeholders and struck-out taken slots, always on white, and must reach 4.5:1 there. It must NOT be
// used on canvas or divider fills (it is below 4.5 on them); those pairs are not listed on purpose.
pairs.push(
  ['subtle on surface (input placeholder)', 'subtle', 'surface', 16],
  ['subtle on surface (struck-out taken time slot)', 'subtle', 'surface', 15],
);

const isLarge = (px, bold) => px >= 24 || (bold && px >= 18.66);
let failures = 0;
const row = (label, fg, bg, px, bold) => {
  const r = ratio(hex(fg), hex(bg));
  const need = isLarge(px, bold) ? 3 : 4.5;
  const ok = r >= need;
  if (!ok) failures++;
  const mark = ok ? 'pass' : 'FAIL';
  console.log(`${mark.padEnd(4)}  ${r.toFixed(2).padStart(5)}:1  (need ${need})  ${label}`);
};
for (const p of pairs) row(...p);
console.log(`\n${failures} failing text pair${failures === 1 ? '' : 's'}`);
process.exit(failures ? 1 : 0);

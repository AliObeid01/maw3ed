/**
 * Output hardening for the MCP tools (prompt-injection stance). Every string a business typed (business, service
 * and staff names, addresses) is data: it is cleaned here, returned in a data field and, when it appears in
 * prose, wrapped by `quote()`. It is never placed inside an instruction or a tool description. Pure.
 */

export const NAME_MAX = 80;
export const ADDRESS_MAX = 200;

// Inclusive code point ranges that are removed: C0/C1 controls (newline and tab are turned into spaces first),
// soft hyphen, Arabic letter mark, Hangul fillers, Khmer/Mongolian invisibles, zero-width and bidi marks,
// embeddings/overrides/isolates, word joiner and invisible math operators, variation selectors, BOM,
// interlinear annotation, and the Unicode tag block (hidden-text smuggling).
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0xe0000, 0xe01ef],
];

const isInvisible = (cp: number) => INVISIBLE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);

// Characters that make Markdown or HTML render links, code or markup out of plain data.
const MARKUP = new Set(['`', '[', ']', '<', '>']);
const BREAKS = new Set([10, 13, 9, 0x85, 0x2028, 0x2029]);

function truncate(chars: string[], max: number): string {
  return chars.slice(0, max).join('').trimEnd();
}

/** Clean one business-entered string: strip invisibles, neutralise Markdown, collapse whitespace, cap. */
export function cleanText(value: unknown, max: number = NAME_MAX): string {
  if (typeof value !== 'string') return '';
  const kept: string[] = [];
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (BREAKS.has(cp)) kept.push(' ');
    else if (isInvisible(cp) || MARKUP.has(ch)) continue;
    else kept.push(ch);
  }
  const collapsed = kept
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[#>*+-]+(?=\s)\s*/, '');
  // Code points, so a surrogate pair is never split.
  return truncate([...collapsed], max);
}

/** A sanitized value inside prose: plain double quotes, inner quotes swapped so it cannot close early. */
export function quote(value: unknown, max: number = NAME_MAX): string {
  return `"${cleanText(value, max).replace(/"/g, '”')}"`;
}

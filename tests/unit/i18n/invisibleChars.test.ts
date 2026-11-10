import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invisible characters (no-break spaces, bidi embeddings, overrides and isolates, joiners, zero-width marks, the soft
 * hyphen) must be written as \uXXXX escapes in the message files, never as raw literals: raw ones are invisible in
 * review and editors/formatters strip them.
 *
 * Deliberately NOT listed: U+200C ZERO WIDTH NON-JOINER and U+200D ZERO WIDTH JOINER. They are legitimate content in
 * Arabic and Persian shaping, so a raw one is not a smell.
 */
const INVISIBLE: Record<string, string> = {
  ' ': 'U+00A0 NO-BREAK SPACE',
  '­': 'U+00AD SOFT HYPHEN',
  ' ': 'U+202F NARROW NO-BREAK SPACE',
  '⁠': 'U+2060 WORD JOINER',
  '⁦': 'U+2066 LRI',
  '⁧': 'U+2067 RLI',
  '⁨': 'U+2068 FSI',
  '⁩': 'U+2069 PDI',
  '‪': 'U+202A LRE',
  '‫': 'U+202B RLE',
  '‬': 'U+202C PDF',
  '‭': 'U+202D LRO',
  '‮': 'U+202E RLO',
  '‎': 'U+200E LRM',
  '‏': 'U+200F RLM',
  '​': 'U+200B ZERO WIDTH SPACE',
  '﻿': 'U+FEFF BOM / ZERO WIDTH NO-BREAK SPACE',
};

/** Every raw invisible character with the JSON key it sits in (found line by line from the file text). */
export function findRawInvisible(text: string): string[] {
  const found: string[] = [];
  const stack: string[] = [];
  text.split('\n').forEach((line, i) => {
    const open = /^\s*"([^"]+)":\s*\{\s*$/.exec(line);
    const leaf = /^\s*"([^"]+)":/.exec(line);
    if (/^\s*\}/.test(line)) stack.pop();
    for (const ch of line) {
      const name = INVISIBLE[ch];
      if (name) found.push(`${[...stack, leaf?.[1] ?? '?'].join('.')} (line ${i + 1}): ${name}`);
    }
    if (open) stack.push(open[1]!);
  });
  return found;
}

describe('the detector itself', () => {
  it('finds every listed character, including the embeddings, overrides and the soft hyphen', () => {
    for (const ch of Object.keys(INVISIBLE)) {
      expect(findRawInvisible(`  "k": "a${ch}b",`), INVISIBLE[ch]).toHaveLength(1);
    }
    for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x00ad]) {
      expect(INVISIBLE[String.fromCodePoint(cp)], cp.toString(16)).toBeDefined();
    }
  });

  it('does not flag ZWNJ and ZWJ (legitimate in Arabic and Persian) or escaped text', () => {
    expect(findRawInvisible('  "k": "a‌b‍c",')).toEqual([]);
    expect(findRawInvisible('  "k": "a\\u202Eb\\u00ad",')).toEqual([]);
  });
});

describe('message files contain no raw invisible characters', () => {
  for (const locale of ['en', 'ar']) {
    it(`${locale}.json uses \\uXXXX escapes`, () => {
      const text = fs.readFileSync(path.resolve(__dirname, `../../../messages/${locale}.json`), 'utf8');
      const found = findRawInvisible(text);
      expect(found, `Raw invisible characters in ${locale}.json: write them as \\uXXXX escapes.\n${found.join('\n')}`).toEqual([]);
    });
  }
});

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

/**
 * Up to two letters for the business monogram: the first grapheme of the first two words, or the
 * first two graphemes of a single word. Grapheme-aware, so emoji (ZWJ sequences, flags) and
 * combining marks are never split. Empty or whitespace-only input gives an empty string.
 */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const letters =
    words.length > 1
      ? [graphemes(words[0]!)[0]!, graphemes(words[1]!)[0]!]
      : graphemes(words[0]!).slice(0, 2);
  return letters.join('').toUpperCase();
}

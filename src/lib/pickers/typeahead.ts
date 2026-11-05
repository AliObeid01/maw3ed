/** Pure matching for the listbox typeahead and the searchable select. */

export type Searchable = { label: string; searchText?: string };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * Index of the option a typed buffer selects (the WAI-ARIA listbox rule): one character cycles through the options
 * starting with it, after the current one; a longer buffer matches by prefix, starting at the current option. Wraps
 * around; disabled options are skipped. -1 when nothing matches.
 */
export function typeaheadIndex(
  options: { label: string; disabled?: boolean }[],
  buffer: string,
  current: number,
): number {
  const text = norm(buffer);
  if (!text || options.length === 0) return -1;
  const scan = (needle: string, from: number) => {
    for (let i = 0; i < options.length; i++) {
      const idx = (((from + i) % options.length) + options.length) % options.length;
      const o = options[idx]!;
      if (!o.disabled && norm(o.label).startsWith(needle)) return idx;
    }
    return -1;
  };
  if (text.length === 1) return scan(text, current + 1);
  const hit = scan(text, Math.max(current, 0));
  // "aaa" with no option starting "aaa" keeps cycling through the options starting with "a".
  if (hit === -1 && [...text].every((c) => c === text[0])) return scan(text[0]!, current + 1);
  return hit;
}

/** Options whose label (or search text) contains every word of the query; label matches at the start come first. */
export function filterOptions<T extends Searchable>(options: T[], query: string): T[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  const scored: { o: T; score: number; i: number }[] = [];
  options.forEach((o, i) => {
    const label = norm(o.label);
    const hay = `${label} ${norm(o.searchText ?? '')}`;
    if (!words.every((w) => hay.includes(w))) return;
    scored.push({ o, score: label.startsWith(words[0]!) ? 0 : 1, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.o);
}

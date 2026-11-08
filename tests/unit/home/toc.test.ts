import { describe, expect, it } from 'vitest';
import { activeSection } from '@/lib/legalToc';

const tops = (...pairs: [string, number][]) => pairs.map(([id, top]) => ({ id, top }));

describe('activeSection (the TOC highlight)', () => {
  const offset = 112; // a TOC link lands a heading at 104 px: just under the 65 px sticky header

  it('is the last heading that has reached the offset line', () => {
    expect(activeSection(tops(['a', -400], ['b', 20], ['c', 500]), offset)).toBe('b');
    expect(activeSection(tops(['a', -400], ['b', -20], ['c', 104]), offset)).toBe('c');
  });
  it('is the first heading before anything has reached the line', () => {
    expect(activeSection(tops(['a', 300], ['b', 700]), offset)).toBe('a');
  });
  it('is the last one at the end of the page', () => {
    expect(activeSection(tops(['a', -900], ['b', -500], ['c', -100]), offset)).toBe('c');
  });
  it('is the last heading at the bottom of the page even when it never reached the line (a short last section)', () => {
    expect(activeSection(tops(['a', -900], ['b', -300], ['c', 420]), offset, true)).toBe('c');
    expect(activeSection(tops(['a', -900], ['b', -300], ['c', 420]), offset, false)).toBe('b');
  });
  it('is null with no headings', () => expect(activeSection([], offset)).toBeNull());
});

import { describe, expect, it } from 'vitest';
import { activeSection } from '@/lib/legalToc';

const tops = (...pairs: [string, number][]) => pairs.map(([id, top]) => ({ id, top }));

describe('activeSection (the TOC highlight)', () => {
  const offset = 96; // sticky header (65 px) plus breathing room

  it('is the last heading that has reached the offset line', () => {
    expect(activeSection(tops(['a', -400], ['b', 20], ['c', 500]), offset)).toBe('b');
    expect(activeSection(tops(['a', -400], ['b', -20], ['c', 96]), offset)).toBe('c');
  });
  it('is the first heading before anything has reached the line', () => {
    expect(activeSection(tops(['a', 300], ['b', 700]), offset)).toBe('a');
  });
  it('is the last one at the end of the page', () => {
    expect(activeSection(tops(['a', -900], ['b', -500], ['c', -100]), offset)).toBe('c');
  });
  it('is null with no headings', () => expect(activeSection([], offset)).toBeNull());
});

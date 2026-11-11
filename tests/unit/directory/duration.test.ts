import { describe, expect, it } from 'vitest';
import { durationParts } from '@/lib/directory/duration';

describe('durationParts', () => {
  it('uses minutes under an hour', () => {
    expect(durationParts(30)).toEqual({ kind: 'min', count: 30 });
    expect(durationParts(59)).toEqual({ kind: 'min', count: 59 });
  });
  it('uses whole hours when there is no remainder', () => {
    expect(durationParts(60)).toEqual({ kind: 'h', count: 1 });
    expect(durationParts(120)).toEqual({ kind: 'h', count: 2 });
  });
  it('uses hours and minutes otherwise', () => {
    expect(durationParts(90)).toEqual({ kind: 'hMin', hours: 1, minutes: 30 });
    expect(durationParts(135)).toEqual({ kind: 'hMin', hours: 2, minutes: 15 });
  });
});

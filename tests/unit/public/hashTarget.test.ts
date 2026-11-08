import { describe, expect, it } from 'vitest';
import { hashTargetId } from '@/lib/hashTarget';

describe('hashTargetId (the id an in-page hash points at)', () => {
  it('reads a plain hash', () => {
    expect(hashTargetId('#reminders')).toBe('reminders');
    expect(hashTargetId('#faq')).toBe('faq');
  });
  it('decodes valid percent escapes', () => {
    expect(hashTargetId('#a%20b')).toBe('a b');
    expect(hashTargetId('#%D9%83')).toBe('ك');
  });
  it('is null for an empty hash', () => {
    expect(hashTargetId('')).toBeNull();
    expect(hashTargetId('#')).toBeNull();
  });
  it('is null (never throws) for a malformed escape', () => {
    expect(() => hashTargetId('#%E0%A4%A')).not.toThrow();
    expect(hashTargetId('#%E0%A4%A')).toBeNull();
    expect(hashTargetId('#%')).toBeNull();
    expect(hashTargetId('#%ZZ')).toBeNull();
  });
});

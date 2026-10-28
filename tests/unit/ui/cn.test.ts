import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/cn';

describe('cn', () => {
  it('lets a custom radius token override another one', () => {
    expect(cn('rounded-card', 'rounded-pill')).toBe('rounded-pill');
    expect(cn('rounded-input', 'rounded-nav')).toBe('rounded-nav');
  });

  it('lets later classes win over earlier conflicting ones', () => {
    expect(cn('px-4 py-2', 'px-6')).toBe('py-2 px-6');
    expect(cn('text-muted', 'text-ink')).toBe('text-ink');
  });

  it('drops falsy values and keeps non-conflicting classes', () => {
    expect(cn('flex', false && 'hidden', undefined, null, 'gap-2')).toBe('flex gap-2');
  });
});

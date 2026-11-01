import { describe, expect, it } from 'vitest';
import { reminderPromiseKind } from '@/lib/reminders/promise';

describe('reminderPromiseKind (which reminder copy the page shows)', () => {
  it('both reminders: the full promise', () => {
    expect(reminderPromiseKind({ h24: true, h2: true, email: true })).toBe('both');
  });
  it('only the 2 h reminder: the slot is under 24 h away', () => {
    expect(reminderPromiseKind({ h24: false, h2: true, email: true })).toBe('h2');
  });
  it('neither: the slot is very close, no promise', () => {
    expect(reminderPromiseKind({ h24: false, h2: false, email: true })).toBe('none');
  });
  it('a lone 24 h reminder never promises the 2 h one', () => {
    expect(reminderPromiseKind({ h24: true, h2: false, email: true })).toBe('h24');
  });
  it('no email address on file: its own variant, chosen only from the server field', () => {
    expect(reminderPromiseKind({ h24: false, h2: false, email: false })).toBe('noEmail');
    expect(reminderPromiseKind({ h24: true, h2: true, email: false })).toBe('noEmail');
  });
});

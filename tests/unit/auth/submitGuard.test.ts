import { describe, expect, it } from 'vitest';
import { createSubmitGuard } from '@/lib/auth/submitGuard';

describe('createSubmitGuard', () => {
  it('lets exactly one of two rapid submits start', () => {
    const guard = createSubmitGuard();
    const started = [guard.tryStart(), guard.tryStart()];
    expect(started).toEqual([true, false]);
    expect(guard.isBusy()).toBe(true);
  });

  it('allows another attempt only after release (a failed submit)', () => {
    const guard = createSubmitGuard();
    guard.tryStart();
    guard.release();
    expect(guard.tryStart()).toBe(true);
  });
});

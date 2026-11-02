import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('browser zod without eval (CSP)', () => {
  it('turns zod JIT off, so zod never probes `new Function` (which a CSP without unsafe-eval reports as a violation)', async () => {
    expect(z.config().jitless).toBeFalsy();
    await import('@/lib/security/zodJitless');
    expect(z.config().jitless).toBe(true);
    // Schemas still parse (the non-JIT path).
    expect(z.object({ a: z.string() }).strict().safeParse({ a: 'x', b: 1 }).success).toBe(false);
    expect(z.object({ a: z.string() }).strict().safeParse({ a: 'x' }).success).toBe(true);
  });
});

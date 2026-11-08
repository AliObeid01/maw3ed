import { describe, expect, it } from 'vitest';
import { checkLogoFile, cropPlan, LOGO_MAX_FILE_BYTES } from '@/lib/setup/logoImage';

describe('checkLogoFile', () => {
  it('accepts png, jpeg and webp within 3 MB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp'])
      expect(checkLogoFile({ type, size: 1000 })).toBeNull();
    expect(checkLogoFile({ type: 'image/png', size: LOGO_MAX_FILE_BYTES })).toBeNull();
  });
  it('rejects other types and oversize files', () => {
    for (const type of ['image/svg+xml', 'image/gif', 'image/avif', 'application/pdf', ''])
      expect(checkLogoFile({ type, size: 10 })).toBe('unsupported');
    expect(checkLogoFile({ type: 'image/png', size: LOGO_MAX_FILE_BYTES + 1 })).toBe('tooLarge');
  });
});

describe('cropPlan', () => {
  it('takes the centred square of a wide picture and caps the output at 512', () => {
    expect(cropPlan(4000, 2000)).toEqual({ sx: 1000, sy: 0, side: 2000, out: 512 });
  });
  it('takes the centred square of a tall picture', () => {
    expect(cropPlan(300, 900)).toEqual({ sx: 0, sy: 300, side: 300, out: 300 });
  });
  it('never scales up', () => {
    expect(cropPlan(120, 120)).toEqual({ sx: 0, sy: 0, side: 120, out: 120 });
  });
});

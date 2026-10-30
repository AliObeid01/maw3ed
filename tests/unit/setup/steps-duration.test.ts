import { describe, expect, it } from 'vitest';
import {
  cutoffFromDisplay,
  cutoffToDisplay,
  cutoffUnit,
  parsePrice,
  parseWhole,
  splitMinutes,
  withCurrent,
} from '@/lib/setup/duration';
import { deriveSetupSteps } from '@/lib/setup/steps';
import { bookingUrl, displayUrl, whatsappShareUrl } from '@/lib/setup/clipboard';

const flags = { hasServices: false, hasBookableStaff: false, hasHours: false };

describe('deriveSetupSteps', () => {
  it('starts with only business details done and services as the current step', () => {
    const { steps, doneCount, percent } = deriveSetupSteps({
      flags,
      shareSeen: false,
      hasReceptionist: false,
    });
    expect(steps.map((s) => s.id)).toEqual([
      'business',
      'services',
      'staff',
      'hours',
      'publish',
      'share',
      'invite',
    ]);
    expect(doneCount).toBe(1);
    expect(percent).toBe(14);
    expect(steps.find((s) => s.current)?.id).toBe('services');
  });

  it('follows the flags and moves the current marker to the first open step', () => {
    const { steps, doneCount } = deriveSetupSteps({
      flags: { hasServices: true, hasBookableStaff: false, hasHours: true },
      shareSeen: false,
      hasReceptionist: false,
    });
    expect(Object.fromEntries(steps.map((s) => [s.id, s.done]))).toEqual({
      business: true,
      services: true,
      staff: false,
      hours: true,
      publish: false,
      share: false,
      invite: false,
    });
    expect(doneCount).toBe(3);
    expect(steps.filter((s) => s.current).map((s) => s.id)).toEqual(['staff']);
  });

  it('share and invite come from their own signals; all done means no current step', () => {
    const all = deriveSetupSteps({
      flags: { hasServices: true, hasBookableStaff: true, hasHours: true },
      shareSeen: true,
      hasReceptionist: true,
      listed: true,
    });
    expect(all.doneCount).toBe(7);
    expect(all.percent).toBe(100);
    expect(all.steps.some((s) => s.current)).toBe(false);
  });
});

describe('duration helpers', () => {
  it('splits minutes into days, hours, minutes', () => {
    expect(splitMinutes(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(splitMinutes(90)).toEqual({ days: 0, hours: 1, minutes: 30 });
    expect(splitMinutes(1440)).toEqual({ days: 1, hours: 0, minutes: 0 });
    expect(splitMinutes(10080)).toEqual({ days: 7, hours: 0, minutes: 0 });
    expect(splitMinutes(1500)).toEqual({ days: 1, hours: 1, minutes: 0 });
  });

  it('shows the cutoff in hours only when it is whole hours', () => {
    expect(cutoffUnit(1440)).toBe('hours');
    expect(cutoffUnit(90)).toBe('min');
    expect(cutoffToDisplay(1440, 'hours')).toBe(24);
    expect(cutoffToDisplay(90, 'min')).toBe(90);
    expect(cutoffFromDisplay(24, 'hours')).toBe(1440);
    expect(cutoffFromDisplay(90, 'min')).toBe(90);
  });

  it('keeps a stored value that is not in the option list', () => {
    expect(withCurrent([10, 20, 30], 25)).toEqual([10, 20, 25, 30]);
    expect(withCurrent([10, 20, 30], 20)).toEqual([10, 20, 30]);
    expect(withCurrent([10, 20, 30], undefined)).toEqual([10, 20, 30]);
  });

  it('parses whole numbers and prices strictly', () => {
    expect(parseWhole(' 30 ')).toBe(30);
    expect(parseWhole('')).toBeNull();
    expect(parseWhole('3.5')).toBeNull();
    expect(parseWhole('-1')).toBeNull();
    expect(parseWhole('abc')).toBeNull();
    expect(parsePrice('15')).toBe(15);
    expect(parsePrice('12,50')).toBe(12.5);
    expect(parsePrice('12.5')).toBe(12.5);
    expect(parsePrice('0')).toBe(0);
    expect(parsePrice('1.234')).toBeNull();
    expect(parsePrice('-3')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });
});

describe('share link helpers', () => {
  it('builds the public booking URL without double slashes', () => {
    expect(bookingUrl('https://maw3ed.com/', 'studio-nour')).toBe(
      'https://maw3ed.com/b/studio-nour',
    );
    expect(displayUrl('https://maw3ed.com/b/studio-nour')).toBe('maw3ed.com/b/studio-nour');
  });

  it('encodes the WhatsApp share text', () => {
    const url = whatsappShareUrl('Book here: https://x.test/b/a b?c=1&d');
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(url).not.toContain(' ');
    expect(decodeURIComponent(url.split('text=')[1]!)).toBe(
      'Book here: https://x.test/b/a b?c=1&d',
    );
  });
});

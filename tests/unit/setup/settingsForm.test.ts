import { describe, expect, it } from 'vitest';
import { cutoffUnit, normaliseDigits, parsePrice, parseWhole } from '@/lib/setup/duration';
import { cutoffMinutes, toSettingsValues } from '@/lib/setup/settingsForm';

const business = (cancelCutoffMin: number) => ({
  name: 'Studio Nour',
  timezone: 'Asia/Beirut',
  slotStepMin: 15,
  bookingWindowDays: 30,
  minNoticeMin: 60,
  cancelCutoffMin,
});

describe('cancellation cutoff unit', () => {
  it('loads 1440 minutes as 24 hours (1 day)', () => {
    const unit = cutoffUnit(1440);
    expect(unit).toBe('hours');
    expect(toSettingsValues(business(1440), unit).cutoff).toBe('24');
  });

  it('keeps minutes for a value that is not whole hours, and survives a save that makes it whole hours', () => {
    // Loaded as 90 min: the unit is chosen once.
    const unit = cutoffUnit(90);
    expect(unit).toBe('min');
    expect(toSettingsValues(business(90), unit).cutoff).toBe('90');

    // The owner types 120 and saves: the payload is 120 minutes, not 7200.
    expect(cutoffMinutes('120', unit)).toBe(120);

    // The server echoes 120. With the unit kept, the field still reads 120 (the bug re-derived 'hours' -> "2").
    const afterSave = toSettingsValues(business(120), unit);
    expect(afterSave.cutoff).toBe('120');
    expect(cutoffUnit(120)).toBe('hours'); // re-deriving here is exactly what must not happen

    // Saving another field afterwards sends the same stored cutoff.
    expect(cutoffMinutes(afterSave.cutoff, unit)).toBe(120);
  });

  it('round-trips hours through minutes without drift', () => {
    const unit = cutoffUnit(2880);
    const values = toSettingsValues(business(2880), unit);
    expect(values.cutoff).toBe('48');
    expect(cutoffMinutes(values.cutoff, unit)).toBe(2880);
  });

  it('rejects non-numeric cutoff text', () => {
    expect(cutoffMinutes('', 'min')).toBeNull();
    expect(cutoffMinutes('1.5', 'hours')).toBeNull();
  });
});

describe('Arabic digit input', () => {
  it('normalises Arabic-Indic and Persian digits and the Arabic decimal separator', () => {
    expect(normaliseDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normaliseDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(normaliseDigits('١٢٫٥٠')).toBe('12.50');
  });

  it('parses whole numbers and prices typed with Arabic digits', () => {
    expect(parseWhole('٣٠')).toBe(30);
    expect(parseWhole('۲۴')).toBe(24);
    expect(parsePrice('١٥')).toBe(15);
    expect(parsePrice('١٢٫٥')).toBe(12.5);
    expect(parsePrice('١٢,٥٠')).toBe(12.5);
  });

  it('still rejects junk', () => {
    expect(parseWhole('٣٠abc')).toBeNull();
    expect(parsePrice('١٫٢٣٤')).toBeNull();
    expect(parsePrice('-٣')).toBeNull();
  });
});

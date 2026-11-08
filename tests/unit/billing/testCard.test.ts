import { describe, expect, it } from 'vitest';
import {
  formatCardNumber,
  formatCvc,
  formatExpiry,
  isLuhnValid,
  scenarioFor,
  validateCard,
  validateExpiry,
} from '@/lib/billing/testCard';

const NOW = new Date('2026-11-08T10:00:00Z');

describe('isLuhnValid', () => {
  it('accepts the documented test numbers and rejects a changed digit', () => {
    expect(isLuhnValid('4242424242424242')).toBe(true);
    expect(isLuhnValid('4000000000000002')).toBe(true);
    expect(isLuhnValid('4242424242424241')).toBe(false);
  });
  it('rejects empty, short, long and non-digit input', () => {
    for (const v of ['', '0', '4242', '42424242424242424242', '4242 4242 4242 4242', 'abcd424242424242'])
      expect(isLuhnValid(v), v).toBe(false);
  });
});

describe('formatting', () => {
  it('groups the card number by four and caps at 19 digits', () => {
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('4242-4242 4242abcd4242')).toBe('4242 4242 4242 4242');
    expect(formatCardNumber('4'.repeat(30)).replaceAll(' ', '')).toHaveLength(19);
    expect(formatCardNumber('')).toBe('');
  });
  it('turns Arabic-Indic digits into Latin ones', () => {
    expect(formatCardNumber('٤٢٤٢٤٢٤٢٤٢٤٢٤٢٤٢')).toBe('4242 4242 4242 4242');
  });
  it('formats the expiry as MM/YY', () => {
    expect(formatExpiry('1')).toBe('1');
    expect(formatExpiry('12')).toBe('12');
    expect(formatExpiry('123')).toBe('12/3');
    expect(formatExpiry('1230')).toBe('12/30');
    expect(formatExpiry('12/3055')).toBe('12/30');
    expect(formatExpiry('4')).toBe('04/');
  });
  it('keeps only up to four digits for the CVC', () => {
    expect(formatCvc('12a345')).toBe('1234');
  });
});

describe('validateExpiry', () => {
  it('accepts this month and later, rejects past months', () => {
    expect(validateExpiry('11/26', NOW)).toBeNull();
    expect(validateExpiry('01/30', NOW)).toBeNull();
    expect(validateExpiry('10/26', NOW)).toBe('expired');
    expect(validateExpiry('12/25', NOW)).toBe('expired');
  });
  it('rejects malformed values and absurdly distant years', () => {
    for (const v of ['', '1', '13/30', '00/30', '1/30', '12-30', '12/2030', 'ab/cd'])
      expect(validateExpiry(v, NOW), v).not.toBeNull();
    expect(validateExpiry('12/60', NOW)).toBe('invalid');
  });
});

describe('scenarioFor (derived on the client from the typed number)', () => {
  it('4242 -> success, the decline test number -> declined, any other valid number -> success', () => {
    expect(scenarioFor('4242 4242 4242 4242')).toBe('success');
    expect(scenarioFor('4000 0000 0000 0002')).toBe('declined');
    expect(scenarioFor('5555 5555 5555 4444')).toBe('success');
  });
  it('is null for an invalid number', () => {
    expect(scenarioFor('4242 4242 4242 4241')).toBeNull();
    expect(scenarioFor('')).toBeNull();
  });
});

describe('validateCard', () => {
  const good = { number: '4242 4242 4242 4242', expiry: '12/30', cvc: '123', name: 'Test Person' };
  it('passes a complete valid card', () => {
    expect(validateCard(good, NOW)).toEqual({});
  });
  it('reports every bad field', () => {
    expect(validateCard({ number: '', expiry: '', cvc: '', name: '' }, NOW)).toEqual({
      number: 'required',
      expiry: 'required',
      cvc: 'required',
      name: 'required',
    });
    expect(
      validateCard({ number: '4242 4242 4242 4241', expiry: '01/20', cvc: '12', name: 'Test Person' }, NOW),
    ).toEqual({ number: 'invalid', expiry: 'expired', cvc: 'invalid' });
  });
});

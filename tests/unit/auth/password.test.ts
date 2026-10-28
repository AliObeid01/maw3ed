import { describe, expect, it } from 'vitest';
import { PASSWORD_MIN, passwordStrength, strengthLevel } from '@/lib/auth/password';

describe('passwordStrength', () => {
  it('is empty for an empty string', () => {
    expect(passwordStrength('')).toBe('empty');
  });

  it('is weak below the minimum length', () => {
    expect(passwordStrength('a'.repeat(PASSWORD_MIN - 1))).toBe('weak');
  });

  it('is fair from the minimum up to 13 characters', () => {
    expect(passwordStrength('a'.repeat(PASSWORD_MIN))).toBe('fair');
    expect(passwordStrength('a'.repeat(13))).toBe('fair');
  });

  it('is strong from 14 characters', () => {
    expect(passwordStrength('a'.repeat(14))).toBe('strong');
  });

  it('applies no composition rules: a long all-lowercase password is strong', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaa')).toBe('strong');
  });

  it('counts characters, not UTF-16 units', () => {
    expect(passwordStrength('😀'.repeat(5))).toBe('weak');
  });
});

describe('strengthLevel', () => {
  it('maps strengths to filled meter segments', () => {
    expect(['empty', 'weak', 'fair', 'strong'].map((s) => strengthLevel(s as never))).toEqual([
      0, 1, 2, 3,
    ]);
  });
});

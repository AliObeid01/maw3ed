export const PASSWORD_MIN = 10;
/** Matches the server limit. */
export const PASSWORD_MAX = 128;
const STRONG_AT = 14;

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'strong';

/** Length-based only (no composition rules): under 10 is too short, 10 to 13 is good, 14+ is strong. */
export function passwordStrength(password: string): PasswordStrength {
  const length = Array.from(password).length;
  if (length === 0) return 'empty';
  if (length < PASSWORD_MIN) return 'weak';
  if (length < STRONG_AT) return 'fair';
  return 'strong';
}

/** How many of the three meter segments are filled. */
export function strengthLevel(strength: PasswordStrength): 0 | 1 | 2 | 3 {
  return { empty: 0, weak: 1, fair: 2, strong: 3 }[strength] as 0 | 1 | 2 | 3;
}

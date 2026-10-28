import { PASSWORD_MAX, PASSWORD_MIN } from './password';
import { isReservedSlug, isValidSlugFormat } from './slug';

/** Message keys under `auth.errors`; the form turns them into translated text. */
export type FieldErrorKey =
  'required' | 'email' | 'passwordShort' | 'passwordLong' | 'slugFormat' | 'slugReserved';
export type FieldErrors<F extends string> = Partial<Record<F, FieldErrorKey>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Length is counted in characters (the server counts UTF-16 units, so this is never stricter than it). */
const tooLong = (p: string) => Array.from(p).length > PASSWORD_MAX;

function newPasswordProblem(p: string): FieldErrorKey | undefined {
  if (!p) return 'required';
  if (tooLong(p)) return 'passwordLong';
  if (Array.from(p).length < PASSWORD_MIN) return 'passwordShort';
  return undefined;
}

export const isEmail = (value: string) => EMAIL_RE.test(value.trim());

export type SignupValues = {
  businessName: string;
  slug: string;
  ownerName: string;
  email: string;
  password: string;
};
export type SignupField = keyof SignupValues | 'timezone';

export function validateSignup(v: SignupValues): FieldErrors<SignupField> {
  const e: FieldErrors<SignupField> = {};
  if (!v.businessName.trim()) e.businessName = 'required';
  if (!v.slug) e.slug = 'required';
  else if (!isValidSlugFormat(v.slug)) e.slug = 'slugFormat';
  else if (isReservedSlug(v.slug)) e.slug = 'slugReserved';
  if (!v.ownerName.trim()) e.ownerName = 'required';
  if (!v.email.trim()) e.email = 'required';
  else if (!isEmail(v.email)) e.email = 'email';
  e.password = newPasswordProblem(v.password);
  if (!e.password) delete e.password;
  return e;
}

export type LoginValues = { email: string; password: string };
export type LoginField = keyof LoginValues;

export function validateLogin(v: LoginValues): FieldErrors<LoginField> {
  const e: FieldErrors<LoginField> = {};
  if (!v.email.trim()) e.email = 'required';
  else if (!isEmail(v.email)) e.email = 'email';
  if (!v.password) e.password = 'required';
  else if (tooLong(v.password)) e.password = 'passwordLong';
  return e;
}

export type AcceptValues = { name: string; password: string };
export type AcceptField = keyof AcceptValues;

export function validateAccept(v: AcceptValues): FieldErrors<AcceptField> {
  const e: FieldErrors<AcceptField> = {};
  if (!v.name.trim()) e.name = 'required';
  // No minimum here: an existing account being invited enters its current password (any length).
  // The server enforces the 10 character minimum for new accounts.
  if (!v.password) e.password = 'required';
  else if (tooLong(v.password)) e.password = 'passwordLong';
  return e;
}

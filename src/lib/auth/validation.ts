import { PASSWORD_MIN } from './password';
import { isValidSlugFormat } from './slug';

/** Message keys under `auth.errors`; the form turns them into translated text. */
export type FieldErrorKey = 'required' | 'email' | 'passwordShort' | 'slugFormat';
export type FieldErrors<F extends string> = Partial<Record<F, FieldErrorKey>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (!v.ownerName.trim()) e.ownerName = 'required';
  if (!v.email.trim()) e.email = 'required';
  else if (!isEmail(v.email)) e.email = 'email';
  if (!v.password) e.password = 'required';
  else if (Array.from(v.password).length < PASSWORD_MIN) e.password = 'passwordShort';
  return e;
}

export type LoginValues = { email: string; password: string };
export type LoginField = keyof LoginValues;

export function validateLogin(v: LoginValues): FieldErrors<LoginField> {
  const e: FieldErrors<LoginField> = {};
  if (!v.email.trim()) e.email = 'required';
  else if (!isEmail(v.email)) e.email = 'email';
  if (!v.password) e.password = 'required';
  return e;
}

export type AcceptValues = { name: string; password: string };
export type AcceptField = keyof AcceptValues;

export function validateAccept(v: AcceptValues): FieldErrors<AcceptField> {
  const e: FieldErrors<AcceptField> = {};
  if (!v.name.trim()) e.name = 'required';
  if (!v.password) e.password = 'required';
  else if (Array.from(v.password).length < PASSWORD_MIN) e.password = 'passwordShort';
  return e;
}

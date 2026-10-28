import { describe, expect, it } from 'vitest';
import { validateAccept, validateLogin, validateSignup } from '@/lib/auth/validation';

const validSignup = {
  businessName: 'Studio Nour',
  slug: 'studio-nour',
  ownerName: 'Lina',
  email: 'lina@example.com',
  password: 'correct horse',
};

describe('validateSignup', () => {
  it('passes valid input', () => {
    expect(validateSignup(validSignup)).toEqual({});
  });

  it('reports every missing field in DOM order', () => {
    const errors = validateSignup({
      businessName: ' ',
      slug: '',
      ownerName: '',
      email: '',
      password: '',
    });
    expect(Object.entries(errors)).toEqual([
      ['businessName', 'required'],
      ['slug', 'required'],
      ['ownerName', 'required'],
      ['email', 'required'],
      ['password', 'required'],
    ]);
  });

  it('distinguishes a bad email, a bad slug and a short password', () => {
    expect(
      validateSignup({ ...validSignup, email: 'lina@', slug: 'Bad Slug', password: 'short' }),
    ).toEqual({ email: 'email', slug: 'slugFormat', password: 'passwordShort' });
  });
});

describe('validateLogin', () => {
  it('requires both fields but never checks password length (existing accounts)', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'required',
      password: 'required',
    });
    expect(validateLogin({ email: 'a@b.co', password: 'x' })).toEqual({});
  });
});

describe('validateAccept', () => {
  it('requires a name and a long enough password', () => {
    expect(validateAccept({ name: '', password: 'short' })).toEqual({
      name: 'required',
      password: 'passwordShort',
    });
    expect(validateAccept({ name: 'Rana', password: 'correct horse' })).toEqual({});
  });
});

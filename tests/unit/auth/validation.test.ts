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
  it('asks for an email or phone when the box is empty, requires the password, and never checks its length (existing accounts)', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'identifierRequired',
      password: 'required',
    });
    expect(validateLogin({ email: 'a@b.co', password: 'x' })).toEqual({});
  });

  it('accepts a phone number in the same box and rejects other text', () => {
    for (const phone of ['70 000 001', '+961 70 000 001', '00961 70 000 001', '٧٠ ٠٠٠ ٠٠١'])
      expect(validateLogin({ email: phone, password: 'x' })).toEqual({});
    for (const bad of ['barber', '123', 'a@b'])
      expect(validateLogin({ email: bad, password: 'x' })).toEqual({ email: 'identifier' });
  });
});

describe('validateAccept', () => {
  it('requires a name and a password but no minimum (an existing account may have a shorter one)', () => {
    expect(validateAccept({ name: '', password: '' })).toEqual({
      name: 'required',
      password: 'required',
    });
    expect(validateAccept({ name: 'Rana', password: 'short' })).toEqual({});
  });

  it('caps the password at 128 characters', () => {
    expect(validateAccept({ name: 'Rana', password: 'a'.repeat(129) })).toEqual({
      password: 'passwordLong',
    });
  });
});

describe('password and slug limits', () => {
  it('rejects a signup password over 128 characters', () => {
    expect(validateSignup({ ...validSignup, password: 'a'.repeat(129) }).password).toBe(
      'passwordLong',
    );
    expect(validateSignup({ ...validSignup, password: 'a'.repeat(128) }).password).toBeUndefined();
  });

  it('gives a reserved slug its own message, not the taken or format one', () => {
    expect(validateSignup({ ...validSignup, slug: 'admin' }).slug).toBe('slugReserved');
  });
});

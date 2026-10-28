import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import { classifyAuthError, mapServerFields } from '@/lib/auth/errors';

const SIGNUP_FIELDS = ['businessName', 'slug', 'ownerName', 'email', 'password', 'timezone'];

describe('classifyAuthError', () => {
  it('shows SLUG_TAKEN and EMAIL_TAKEN on their own fields, not in the banner', () => {
    expect(classifyAuthError(new ApiError(409, 'SLUG_TAKEN', 'x'), SIGNUP_FIELDS)).toEqual({
      fields: { slug: { key: 'slugTaken' } },
    });
    expect(classifyAuthError(new ApiError(409, 'EMAIL_TAKEN', 'x'), SIGNUP_FIELDS)).toEqual({
      fields: { email: { key: 'emailTaken' } },
    });
  });

  it('falls back to the banner when the form has no such field', () => {
    expect(classifyAuthError(new ApiError(409, 'SLUG_TAKEN', 'x'), ['email', 'password'])).toEqual({
      fields: {},
      banner: 'generic',
    });
  });

  it('uses one generic banner for INVALID_CREDENTIALS and puts nothing on a field', () => {
    const result = classifyAuthError(
      new ApiError(401, 'INVALID_CREDENTIALS', 'x', { password: 'wrong' }),
      ['email', 'password'],
    );
    expect(result).toEqual({ fields: {}, banner: 'invalidCredentials' });
  });

  it('maps rate limiting and network failures to their banners', () => {
    expect(classifyAuthError(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'x'), []).banner).toBe(
      'tooManyAttempts',
    );
    expect(classifyAuthError(new ApiError(0, 'NETWORK', 'x'), []).banner).toBe('network');
  });

  it('treats anything unexpected as generic', () => {
    expect(classifyAuthError(new Error('boom'), []).banner).toBe('generic');
    expect(classifyAuthError(new ApiError(500, 'HTTP_500', 'x'), []).banner).toBe('generic');
  });

  it('routes VALIDATION_FAILED fields to translated keys, never the raw server text', () => {
    const error = new ApiError(400, 'VALIDATION_FAILED', 'x', {
      email: 'Email domain not allowed',
    });
    expect(classifyAuthError(error, SIGNUP_FIELDS)).toEqual({
      fields: { email: { key: 'invalidField' } },
      banner: 'fixFields',
    });
  });

  it('maps a server password problem to the translated minimum-length message', () => {
    const error = new ApiError(400, 'VALIDATION_FAILED', 'x', {
      password: 'Use at least 10 characters.',
    });
    expect(classifyAuthError(error, SIGNUP_FIELDS).fields).toEqual({
      password: { key: 'passwordShort' },
    });
  });
});

describe('classifyAuthError for the invite accept form', () => {
  const fields = ['name', 'password'];

  it('401 INVALID_CREDENTIALS gets the invite-specific wrong-password banner', () => {
    const e = new ApiError(401, 'INVALID_CREDENTIALS', 'x');
    expect(classifyAuthError(e, fields, 'invite')).toEqual({
      fields: {},
      banner: 'inviteWrongPassword',
    });
    expect(classifyAuthError(e, fields).banner).toBe('invalidCredentials');
  });

  it('409 ALREADY_MEMBER gets its own banner', () => {
    expect(classifyAuthError(new ApiError(409, 'ALREADY_MEMBER', 'x'), fields, 'invite')).toEqual({
      fields: {},
      banner: 'alreadyMember',
    });
  });

  it('404 means the invite is gone, so the view can switch to the expired state', () => {
    expect(classifyAuthError(new ApiError(404, 'NOT_FOUND', 'x'), fields, 'invite').gone).toBe(
      true,
    );
    expect(
      classifyAuthError(new ApiError(500, 'HTTP_500', 'x'), fields, 'invite').gone,
    ).toBeUndefined();
  });

  it('429 maps to the rate limit banner', () => {
    expect(
      classifyAuthError(new ApiError(429, 'TOO_MANY_ATTEMPTS', 'x'), fields, 'invite').banner,
    ).toBe('tooManyAttempts');
  });
});

describe('mapServerFields', () => {
  it('keeps known fields and shows the banner even when some fields have no input', () => {
    expect(mapServerFields({ email: 'Invalid', unknownField: 'Nope' }, ['email'])).toEqual({
      fields: { email: { key: 'invalidField' } },
      banner: 'fixFields',
    });
  });

  it('gives the banner (not silence) when nothing maps', () => {
    expect(mapServerFields({}, ['email'])).toEqual({ fields: {}, banner: 'generic' });
    expect(mapServerFields({ other: 'x' }, ['email'])).toEqual({ fields: {}, banner: 'generic' });
  });
});

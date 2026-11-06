import { describe, expect, it } from 'vitest';
import { firstNameOf, scopeFor, scopeWhere } from '@/server/domain/scope';

describe('scopeFor (which rows a session may see)', () => {
  it('OWNER and STAFF see the whole business, whatever staff link they have', () => {
    expect(scopeFor('OWNER', null)).toEqual({ kind: 'all' });
    expect(scopeFor('STAFF', 'staff-1')).toEqual({ kind: 'all' });
  });
  it('PRACTITIONER sees only the linked staff member', () => {
    expect(scopeFor('PRACTITIONER', 'staff-1')).toEqual({ kind: 'own', staffId: 'staff-1' });
  });
  it('PRACTITIONER without a linked, active staff member has no scope at all (never "all")', () => {
    expect(scopeFor('PRACTITIONER', null)).toBeNull();
    expect(scopeFor('PRACTITIONER', '')).toBeNull();
  });
  it('an unknown role has no scope', () => {
    expect(scopeFor('GUEST' as never, 'staff-1')).toBeNull();
  });
});

describe('scopeWhere (the filter every scoped repository query adds)', () => {
  it('adds nothing for all and the staff id for own', () => {
    expect(scopeWhere({ kind: 'all' })).toEqual({});
    expect(scopeWhere({ kind: 'own', staffId: 'staff-1' })).toEqual({ staffId: 'staff-1' });
  });
});

describe('firstNameOf (the barber never sees a surname)', () => {
  it.each([
    ['Rana Haddad', 'Rana'],
    ['  Rana   Haddad ', 'Rana'],
    ['Rana', 'Rana'],
    ['رنا الحداد', 'رنا'],
    ['', ''],
  ])('%j -> %j', (name, first) => expect(firstNameOf(name)).toBe(first));
});

import { describe, expect, it } from 'vitest';
import { checkRemoval } from '@/server/domain/teamAccess';

describe('checkRemoval (pure rule)', () => {
  it('an owner cannot remove themselves', () => {
    expect(
      checkRemoval({ actorUserId: 'u1', targetUserId: 'u1', targetRole: 'OWNER', ownerCount: 2 }),
    ).toBe('SELF');
  });
  it('self wins over last owner', () => {
    expect(
      checkRemoval({ actorUserId: 'u1', targetUserId: 'u1', targetRole: 'OWNER', ownerCount: 1 }),
    ).toBe('SELF');
  });
  it('the last owner can never be removed', () => {
    expect(
      checkRemoval({ actorUserId: 'u2', targetUserId: 'u1', targetRole: 'OWNER', ownerCount: 1 }),
    ).toBe('LAST_OWNER');
    expect(
      checkRemoval({ actorUserId: 'u2', targetUserId: 'u1', targetRole: 'OWNER', ownerCount: 0 }),
    ).toBe('LAST_OWNER');
  });
  it('one of several owners can be removed by another owner', () => {
    expect(
      checkRemoval({ actorUserId: 'u2', targetUserId: 'u1', targetRole: 'OWNER', ownerCount: 2 }),
    ).toBe('ok');
  });
  it('a staff member can always be removed by an owner', () => {
    expect(
      checkRemoval({ actorUserId: 'u1', targetUserId: 'u3', targetRole: 'STAFF', ownerCount: 1 }),
    ).toBe('ok');
  });
});

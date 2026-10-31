export type RemovalVerdict = 'ok' | 'SELF' | 'LAST_OWNER';

/**
 * Pure rule for removing a member's access. `ownerCount` is the number of OWNER memberships the business
 * has right now (counted under a lock by the caller). Nobody removes themselves, and a business always
 * keeps at least one owner.
 */
export function checkRemoval(input: {
  actorUserId: string;
  targetUserId: string;
  targetRole: 'OWNER' | 'STAFF';
  ownerCount: number;
}): RemovalVerdict {
  if (input.actorUserId === input.targetUserId) return 'SELF';
  if (input.targetRole === 'OWNER' && input.ownerCount <= 1) return 'LAST_OWNER';
  return 'ok';
}

/**
 * Row scope of a session. OWNER and STAFF work on the whole business; a PRACTITIONER (barber login) only on the
 * appointments of the staff member their login is linked to. Pure: the repository reads the link, this decides.
 */
export type Scope = { kind: 'all' } | { kind: 'own'; staffId: string };

export const ALL_SCOPE: Scope = { kind: 'all' };

/**
 * The scope for a role, or null when the session has none: a PRACTITIONER without a linked, active staff member
 * (or any unknown role) gets no scope, never "all".
 */
export function scopeFor(role: string, linkedStaffId: string | null | undefined): Scope | null {
  if (role === 'OWNER' || role === 'STAFF') return ALL_SCOPE;
  if (role === 'PRACTITIONER' && linkedStaffId) return { kind: 'own', staffId: linkedStaffId };
  return null;
}

/** Prisma `where` fragment for an Appointment query. Every scoped repository method spreads this in. */
export function scopeWhere(scope: Scope): { staffId?: string } {
  return scope.kind === 'own' ? { staffId: scope.staffId } : {};
}

/** The first word of a client's name: all a barber sees of a client besides the phone. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

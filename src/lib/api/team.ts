import { z } from 'zod';
import { request } from './auth';

// Typed client for the team endpoints (owner) and "sign out other sessions" (any role).

export const teamMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['OWNER', 'STAFF']),
  emailVerified: z.boolean(),
  isYou: z.boolean(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const teamInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
  expiresAt: z.string(),
  createdAt: z.string(),
});
export type TeamInvite = z.infer<typeof teamInviteSchema>;

const teamSchema = z.object({
  members: z.array(teamMemberSchema),
  invites: z.array(teamInviteSchema),
});
export type Team = z.infer<typeof teamSchema>;

const okSchema = z.object({ ok: z.literal(true) });
const seg = encodeURIComponent;

export const listTeam = (signal?: AbortSignal) => request('/api/team', teamSchema, { signal });

export const removeTeamMember = (userId: string) =>
  request(`/api/team/members/${seg(userId)}`, okSchema, { method: 'DELETE' });

export const revokeTeamInvite = (inviteId: string) =>
  request(`/api/team/invites/${seg(inviteId)}`, okSchema, { method: 'DELETE' });

export const signOutOtherSessions = () =>
  request('/api/auth/sign-out-others', z.object({ removed: z.number() }), { method: 'POST' });

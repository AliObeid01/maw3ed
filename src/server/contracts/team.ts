import { z } from 'zod';
import { ErrorResponse, errorResponses, registry } from './registry';

const RoleEnum = z.enum(['OWNER', 'STAFF']);
const id = z.string().cuid2();

/** `id` is the userId of the member (Membership is unique per user and business) or the invite id. */
export const TeamIdParams = z.object({ id }).strict();

export const TeamMemberDto = registry.register(
  'TeamMember',
  z.object({
    userId: z.string(),
    name: z.string(),
    email: z.string(),
    role: RoleEnum,
    emailVerified: z.boolean(),
    isYou: z.boolean().openapi({ description: 'True for the signed-in caller.' }),
  }),
);

export const TeamInviteDto = registry.register(
  'TeamInvite',
  z.object({
    id: z.string(),
    email: z.string(),
    role: RoleEnum,
    expiresAt: z.string().datetime(),
    createdAt: z.string().datetime(),
  }),
);

export const TeamDto = registry.register(
  'Team',
  z.object({
    members: z.array(TeamMemberDto).openapi({ description: 'Oldest membership first.' }),
    invites: z
      .array(TeamInviteDto)
      .openapi({ description: 'Pending (not accepted, not expired) invites, newest first.' }),
  }),
);

export const SignedOutOthersDto = registry.register(
  'SignedOutOthers',
  z.object({ removed: z.number().int().min(0) }),
);

const OkDto = registry.register('TeamOk', z.object({ ok: z.literal(true) }));

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });
const security = [{ session: [] }];
const e = errorResponses;

registry.registerPath({
  method: 'get',
  path: '/api/team',
  summary: 'Team members and pending invites (owner)',
  description:
    'Never contains password hashes, invite tokens or session data. Members carry no free-text fields.',
  tags: ['team'],
  security,
  responses: {
    200: { description: 'Members and pending invites', content: json(TeamDto) },
    401: e[401],
    403: e[403],
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/team/members/{id}',
  summary: 'Remove a team member access (owner)',
  description:
    'Deletes the user Membership for THIS business and all of that user Sessions for THIS business in one transaction, and any pending invite for their email here. The User row, their other businesses, the calendar entry (StaffMember, which is only unlinked) and appointments are kept. `id` is the member userId. An owner cannot remove themselves (409 CANNOT_REMOVE_SELF) and the last owner can never be removed (409 LAST_OWNER). Another business, an unknown or an already removed member is 404.',
  tags: ['team'],
  security,
  request: { params: TeamIdParams },
  responses: {
    200: { description: 'Removed', content: json(OkDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
    409: err('CANNOT_REMOVE_SELF or LAST_OWNER'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/team/invites/{id}',
  summary: 'Revoke a pending invite (owner)',
  description:
    'Deletes the invite row, so its link stops working at once. Another business, an unknown or an already accepted invite is 404.',
  tags: ['team'],
  security,
  request: { params: TeamIdParams },
  responses: {
    200: { description: 'Revoked', content: json(OkDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/sign-out-others',
  summary: 'Sign out every other session of the signed-in user',
  description:
    'Deletes all of the caller sessions in every business EXCEPT the current one and answers how many were removed. Any role. Limited to 20 per 10 minutes per IP (429 RATE_LIMITED).',
  tags: ['auth'],
  security,
  responses: {
    200: { description: 'Other sessions removed', content: json(SignedOutOthersDto) },
    401: e[401],
    429: err('RATE_LIMITED'),
  },
});

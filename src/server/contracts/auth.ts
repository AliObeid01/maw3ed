import { z } from 'zod';
import { ErrorResponse, errorResponses, registry } from './registry';
import { isValidTimezone } from './slug';

const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const password = z.string().min(10, 'Use at least 10 characters.').max(128);
const name = z.string().trim().min(1).max(80);

export const SignupBody = registry.register(
  'SignupBody',
  z
    .object({
      businessName: name,
      slug: z.string().trim().toLowerCase().min(1).max(80),
      timezone: z
        .string()
        .trim()
        .refine(isValidTimezone, 'Use an IANA timezone such as Asia/Beirut.'),
      ownerName: name,
      email,
      password,
    })
    .strict(),
);

export const LoginBody = registry.register(
  'LoginBody',
  z.object({ email, password: z.string().min(1).max(128) }).strict(),
);

export const SlugCheckQuery = z.object({ slug: z.string().trim().toLowerCase().max(80) }).strict();

export const SlugCheckDto = registry.register(
  'SlugCheck',
  z.object({
    available: z.boolean(),
    reason: z.enum(['invalid', 'reserved', 'taken']).optional(),
  }),
);

export const InviteBody = registry.register(
  'InviteBody',
  z.object({ email, role: z.literal('STAFF') }).strict(),
);

export const TokenParams = z.object({ token: z.string().min(1).max(200) }).strict();

export const AcceptInviteBody = registry.register(
  'AcceptInviteBody',
  z.object({ name, password: z.string().min(1).max(128) }).strict(),
);

const RoleEnum = z.enum(['OWNER', 'STAFF']);

export const SessionDto = registry.register(
  'SessionInfo',
  z.object({
    user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
    business: z.object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      timezone: z.string(),
    }),
    role: RoleEnum,
  }),
);

export const InviteDto = registry.register(
  'Invite',
  z.object({
    id: z.string(),
    email: z.string(),
    role: RoleEnum,
    expiresAt: z.string().datetime(),
    acceptUrl: z
      .string()
      .optional()
      .openapi({ description: 'Only returned when EMAIL_PROVIDER=fake (development).' }),
  }),
);

export const InvitePreviewDto = registry.register(
  'InvitePreview',
  z.object({
    businessName: z.string(),
    email: z.string(),
    role: RoleEnum,
    expiresAt: z.string().datetime(),
  }),
);

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });

registry.registerPath({
  method: 'post',
  path: '/api/auth/signup',
  summary: 'Create a business and its owner; signs in',
  tags: ['auth'],
  request: { body: { content: json(SignupBody) } },
  responses: {
    201: { description: 'Created; session cookie set', content: json(SessionDto) },
    400: errorResponses[400],
    409: err('SLUG_TAKEN or EMAIL_TAKEN'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/slug-check',
  summary: 'Is a booking-page slug free?',
  tags: ['auth'],
  request: { query: SlugCheckQuery },
  responses: {
    200: { description: 'Availability', content: json(SlugCheckDto) },
    400: errorResponses[400],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  summary: 'Sign in with email and password',
  description:
    'A user with several memberships is signed into the most recently created one. 5 failures per email in 15 minutes -> 429 TOO_MANY_ATTEMPTS.',
  tags: ['auth'],
  request: { body: { content: json(LoginBody) } },
  responses: {
    200: { description: 'Signed in; session cookie set', content: json(SessionDto) },
    400: errorResponses[400],
    401: err('INVALID_CREDENTIALS (same body for wrong email and wrong password)'),
    429: err('TOO_MANY_ATTEMPTS'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  summary: 'Sign out: delete the session and clear the cookie',
  tags: ['auth'],
  security: [{ session: [] }],
  responses: { 204: { description: 'Signed out' }, 401: errorResponses[401] },
});

registry.registerPath({
  method: 'get',
  path: '/api/me',
  summary: 'Current user, business and role',
  tags: ['auth'],
  security: [{ session: [] }],
  responses: {
    200: { description: 'Session info', content: json(SessionDto) },
    401: errorResponses[401],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invites',
  summary: 'Invite a staff member by email (OWNER only)',
  description: 'Re-inviting an email replaces its previous open invite. Expires after 72 hours.',
  tags: ['invites'],
  security: [{ session: [] }],
  request: { body: { content: json(InviteBody) } },
  responses: {
    201: { description: 'Invite created and emailed', content: json(InviteDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    409: err('ALREADY_MEMBER'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/invites/{token}',
  summary: 'Preview an invite (public)',
  tags: ['invites'],
  request: { params: TokenParams },
  responses: {
    200: { description: 'Invite details', content: json(InvitePreviewDto) },
    404: err('Unknown, used or expired (not distinguished)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/invites/{token}/accept',
  summary: 'Accept an invite (public, single use); signs in',
  description:
    'New email: creates the user (password min 10). Existing user: must supply their current password.',
  tags: ['invites'],
  request: { params: TokenParams, body: { content: json(AcceptInviteBody) } },
  responses: {
    200: { description: 'Joined; session cookie set', content: json(SessionDto) },
    400: errorResponses[400],
    401: err('INVALID_CREDENTIALS (existing user, wrong password)'),
    404: err('Unknown, used or expired (not distinguished)'),
    409: err('ALREADY_MEMBER'),
    429: err('TOO_MANY_ATTEMPTS'),
  },
});

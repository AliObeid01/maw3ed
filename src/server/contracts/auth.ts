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
  z
    .object({
      identifier: z
        .string()
        .trim()
        .min(1)
        .max(254)
        .optional()
        .openapi({ description: 'Primary field: an email address or a phone number (E.164 or a Lebanese national number). Send this or the legacy `email`, not both.' }),
      email: z
        .string()
        .trim()
        .min(1)
        .max(254)
        .optional()
        .openapi({ deprecated: true, description: 'Legacy alias of `identifier`, kept for older clients. New clients send `identifier`.' }),
      password: z.string().min(1).max(128),
    })
    .strict()
    .refine((b) => (b.identifier === undefined) !== (b.email === undefined), {
      message: 'Send either identifier or email.',
      path: ['identifier'],
    }),
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

export const ForgotPasswordBody = registry.register(
  'ForgotPasswordBody',
  z.object({ email }).strict(),
);

export const ResetPasswordBody = registry.register(
  'ResetPasswordBody',
  z.object({ token: z.string().min(1).max(200), newPassword: password }).strict(),
);

export const ChangePasswordBody = registry.register(
  'ChangePasswordBody',
  z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(),
);

export const VerifyEmailBody = registry.register(
  'VerifyEmailBody',
  z.object({ token: z.string().min(1).max(200) }).strict(),
);

export const OkDto = registry.register('Ok', z.object({ ok: z.literal(true) }));

export const ResendVerificationDto = registry.register(
  'ResendVerification',
  z.object({ ok: z.literal(true), alreadyVerified: z.boolean() }),
);

const RoleEnum = z.enum(['OWNER', 'STAFF', 'PRACTITIONER']);

export const SessionDto = registry.register(
  'SessionInfo',
  z.object({
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable().openapi({ description: 'Null for phone-only staff logins.' }),
      phone: z.string().nullable().openapi({ description: 'E.164. Set for staff (barber) logins.' }),
      emailVerified: z.boolean().openapi({
        description:
          'False until the address is confirmed (verify link, password reset or accepted staff invite). An unverified owner cannot invite staff or list the business in the directory (409 EMAIL_NOT_VERIFIED).',
      }),
    }),
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
  summary: 'Sign in with email or phone number and password',
  description:
    '`identifier` is the primary field: an email address or a phone number (E.164 or a Lebanese national number). The older `email` field is a legacy alias (deprecated) and is still accepted; send one of the two, never both. Wrong identifier, unknown phone and wrong password are the same 401. A user with several memberships is signed into the most recently created one. Attempts are counted before the password is checked: 5 per email+IP per 15 minutes, 20 per IP per 15 minutes (all emails) and 30 per email per hour (all IPs); a success refunds its hits. Over a limit -> 429 TOO_MANY_ATTEMPTS with Retry-After. IPv6 addresses are limited per /64. Password checks are capped per server instance: 503 SERVICE_BUSY with Retry-After when saturated.',
  tags: ['auth'],
  request: { body: { content: json(LoginBody) } },
  responses: {
    200: { description: 'Signed in; session cookie set', content: json(SessionDto) },
    400: errorResponses[400],
    401: err('INVALID_CREDENTIALS (same body for wrong email and wrong password)'),
    429: err('TOO_MANY_ATTEMPTS'),
    503: err('SERVICE_BUSY (Retry-After: 2)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/verify-email',
  summary: 'Confirm an email address with the emailed token (public, single use)',
  description:
    'The token comes from the link in the verification email (valid 24 hours). Unknown, expired, used and wrong-kind tokens are the same 410 LINK_INVALID. The page that shows the link only displays a button: opening the link never changes state, only this POST does.',
  tags: ['auth'],
  request: { body: { content: json(VerifyEmailBody) } },
  responses: {
    200: { description: 'Address confirmed', content: json(OkDto) },
    400: errorResponses[400],
    410: err('LINK_INVALID (unknown, expired or already used; not distinguished)'),
    429: err('RATE_LIMITED'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/resend-verification',
  summary: 'Send a new verification email to the signed-in user',
  description:
    'Older unused links keep working until one succeeds (at most 5 live per user). Limited to 3 per hour per user and 10 per hour per IP (429 RATE_LIMITED with Retry-After). An already verified user gets 200 with alreadyVerified true and nothing is sent.',
  tags: ['auth'],
  security: [{ session: [] }],
  responses: {
    200: { description: 'Sent (or already verified)', content: json(ResendVerificationDto) },
    401: errorResponses[401],
    429: err('RATE_LIMITED'),
    503: err('SERVICE_UNAVAILABLE (the email could not be sent)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/forgot-password',
  summary: 'Ask for a password-reset email (public)',
  description:
    'ALWAYS answers the same 200 whether or not an account exists (no user enumeration); only the rate-limit count happens before the response, the lookup and the email run after it. Past 5 per hour per email address the answer is still the same 200 and nothing is sent (no per-email 429). 10 per hour per IP -> 429 RATE_LIMITED, identical for every email. The link is valid for 1 hour and works once; several links may coexist (at most 5 live) and using one deletes the others.',
  tags: ['auth'],
  request: { body: { content: json(ForgotPasswordBody) } },
  responses: {
    200: { description: 'Generic acknowledgement', content: json(OkDto) },
    400: errorResponses[400],
    429: err('RATE_LIMITED'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password',
  summary: 'Set a new password with the emailed token (public, single use)',
  description:
    'Sets the new argon2 hash, marks the token used, marks the email verified and REVOKES ALL sessions of that user (it does not sign anyone in). Same password rules as signup (10 to 128 characters). Unknown, expired, used and wrong-kind tokens are the same 410 LINK_INVALID; a weak password is a 400 and does not use up the token.',
  tags: ['auth'],
  request: { body: { content: json(ResetPasswordBody) } },
  responses: {
    200: { description: 'Password changed', content: json(OkDto) },
    400: errorResponses[400],
    410: err('LINK_INVALID (unknown, expired or already used; not distinguished)'),
    429: err('RATE_LIMITED'),
    503: err('SERVICE_BUSY (Retry-After: 2)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/change-password',
  summary: 'Change the signed-in user password',
  description:
    'Verifies the current password (a wrong one is a 400 on currentPassword), sets the new hash and revokes all OTHER sessions of the user; the current session stays. Limited to 5 attempts per 15 minutes per user.',
  tags: ['auth'],
  security: [{ session: [] }],
  request: { body: { content: json(ChangePasswordBody) } },
  responses: {
    200: { description: 'Password changed', content: json(OkDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    429: err('RATE_LIMITED'),
    503: err('SERVICE_BUSY (Retry-After: 2)'),
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
    409: err('ALREADY_MEMBER, or EMAIL_NOT_VERIFIED when the owner has not confirmed their email yet'),
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

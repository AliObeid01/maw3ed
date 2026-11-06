import { z } from 'zod';
import { OkDto, SessionDto, TokenParams } from './auth';
import { ErrorResponse, errorResponses, registry } from './registry';

const id = z.string().cuid2();
export const StaffLoginParams = z.object({ id }).strict();
export { TokenParams as ActivationParams };

/** `phone` is required for a first link and ignored when a login already exists (reset keeps its phone). */
export const StaffLoginBody = registry.register(
  'StaffLoginBody',
  z.object({ phone: z.string().trim().min(1).max(40).optional() }).strict(),
);

export const StaffLoginLinkDto = registry.register(
  'StaffLoginLink',
  z.object({
    url: z
      .string()
      .openapi({
        description: 'The one-time activation link. Shown once; only its hash is stored.',
      }),
    whatsappUrl: z.string().openapi({
      description: 'wa.me link with the prefilled message; opened on the owner phone.',
    }),
    phone: z.string(),
    expiresAt: z.string().datetime(),
    reset: z.boolean().openapi({
      description: 'True when the person already had a login: their sessions were revoked.',
    }),
  }),
);

export const ActivateBody = registry.register(
  'ActivateBody',
  z.object({ password: z.string().min(10, 'Use at least 10 characters.').max(128) }).strict(),
);

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });

registry.registerPath({
  method: 'post',
  path: '/api/staff/{id}/login',
  summary: 'Give a staff member a login, or reset their access (OWNER only)',
  description:
    'Creates a one-time activation link (valid 72 hours, single use) for the phone number; the previous link dies. If the person already has a login, this resets it: sessions are revoked and the next use of the link sets a new password. The link is returned once and sent by the owner (WhatsApp, one tap). 409 PHONE_IN_USE when the number belongs to another account; 409 LOGIN_NOT_ALLOWED for the owner and receptionists.',
  tags: ['staff'],
  security: [{ session: [] }],
  request: { params: StaffLoginParams, body: { content: json(StaffLoginBody) } },
  responses: {
    200: { description: 'Link created', content: json(StaffLoginLinkDto) },
    400: errorResponses[400],
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
    409: err('PHONE_IN_USE, LOGIN_NOT_ALLOWED or STAFF_INACTIVE'),
    429: err('RATE_LIMITED'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/staff/{id}/login',
  summary: 'Turn a staff login off (OWNER only)',
  description:
    'Revokes the open link and the sessions, removes the PRACTITIONER membership and unlinks the user. The staff member and every appointment stay. Idempotent.',
  tags: ['staff'],
  security: [{ session: [] }],
  request: { params: StaffLoginParams },
  responses: {
    200: { description: 'Done', content: json(OkDto) },
    401: errorResponses[401],
    403: errorResponses[403],
    404: errorResponses[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/activation/{token}',
  summary: 'Is this activation link usable? (public)',
  description:
    'Answers 200 {ok:true} or the same 404 for unknown, used, expired, replaced and revoked links. Reveals nothing else.',
  tags: ['staff'],
  request: { params: TokenParams },
  responses: {
    200: { description: 'Usable', content: json(OkDto) },
    404: errorResponses[404],
    429: err('RATE_LIMITED'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/activation/{token}',
  summary: 'Choose a password with an activation link and sign in (public, single use)',
  description:
    'Sets the password (10 to 128 characters), grants the PRACTITIONER role, links the staff member and signs the person in. Unknown, used, expired and replaced links are the same 404. Limited to 20 per 10 minutes per IP.',
  tags: ['staff'],
  request: { params: TokenParams, body: { content: json(ActivateBody) } },
  responses: {
    200: { description: 'Signed in; session cookie set', content: json(SessionDto) },
    400: errorResponses[400],
    404: errorResponses[404],
    429: err('RATE_LIMITED'),
  },
});

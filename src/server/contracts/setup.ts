import { z } from 'zod';
import { MAX_INTERVALS_TOTAL } from '../domain/hours';
import { isCents } from '../domain/money';
import { ErrorResponse, errorResponses, registry } from './registry';
import { isValidTimezone } from './slug';

/* ---------- shared pieces ---------- */
const id = z.string().cuid2();
const iso = z.iso.datetime();
const RoleEnum = z.enum(['OWNER', 'STAFF']);
const flag = z.enum(['1', '0', 'true', 'false']).transform((v) => v === '1' || v === 'true');

export const IdParams = z.object({ id }).strict();
export const StaffParams = IdParams;
export const TimeOffParams = z.object({ id, timeOffId: id }).strict();

/* ---------- business ---------- */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === '' ? null : v));

export const UpdateBusinessBody = registry.register(
  'UpdateBusinessBody',
  z
    .object({
      name: z.string().trim().min(1).max(80),
      timezone: z
        .string()
        .trim()
        .refine(isValidTimezone, 'Use an IANA timezone such as Asia/Beirut.'),
      slotStepMin: z.union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(20),
        z.literal(30),
        z.literal(60),
      ]),
      bookingWindowDays: z.number().int().min(1).max(365),
      minNoticeMin: z.number().int().min(0).max(10080),
      cancelCutoffMin: z.number().int().min(0).max(10080),
      category: nullableText(40),
      address: nullableText(120),
      listed: z.boolean().openapi({
        description:
          'Opt in to the public directory. Turning it on needs a ready business (409 NOT_READY).',
      }),
    })
    .partial()
    .strict(),
);

export const BusinessDto = registry.register(
  'Business',
  z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    locale: z.string(),
    slotStepMin: z.number().int(),
    bookingWindowDays: z.number().int(),
    minNoticeMin: z.number().int(),
    cancelCutoffMin: z.number().int(),
    category: z.string().nullable(),
    address: z.string().nullable(),
    listed: z.boolean(),
    readiness: z.object({ services: z.boolean(), staff: z.boolean(), hours: z.boolean() }),
    setup: z.object({
      hasServices: z.boolean(),
      hasBookableStaff: z.boolean(),
      hasHours: z.boolean(),
    }),
  }),
);
export type BusinessDtoT = z.infer<typeof BusinessDto>;

/* ---------- services ---------- */
const price = z.number().min(0).max(100000).refine(isCents, 'At most 2 decimals.');
const serviceName = z.string().trim().min(1).max(80);
const durationMin = z.number().int().min(5).max(600);
const bufferMin = z.number().int().min(0).max(120);

export const CreateServiceBody = registry.register(
  'CreateServiceBody',
  z.object({ name: serviceName, durationMin, bufferMin: bufferMin.default(0), price }).strict(),
);
export const UpdateServiceBody = registry.register(
  'UpdateServiceBody',
  z
    .object({
      name: serviceName,
      durationMin,
      bufferMin,
      price,
      active: z.boolean(),
      sortOrder: z.number().int().min(0).max(10000),
    })
    .partial()
    .strict(),
);
export const ServiceListQuery = z.object({ includeInactive: flag.optional() }).strict();

export const ServiceDto = registry.register(
  'Service',
  z.object({
    id: z.string(),
    name: z.string(),
    durationMin: z.number().int(),
    bufferMin: z.number().int(),
    price: z.number(),
    active: z.boolean(),
    sortOrder: z.number().int(),
  }),
);
export type ServiceDtoT = z.infer<typeof ServiceDto>;
export const ServiceListDto = registry.register(
  'ServiceList',
  z.object({ services: z.array(ServiceDto) }),
);

/* ---------- staff ---------- */
const serviceIds = z.array(id).max(200);
const displayName = z.string().trim().min(1).max(60);

export const CreateStaffBody = registry.register(
  'CreateStaffBody',
  z.object({ displayName, bookable: z.boolean(), serviceIds }).strict(),
);
export const UpdateStaffBody = registry.register(
  'UpdateStaffBody',
  z.object({ displayName, bookable: z.boolean(), active: z.boolean() }).partial().strict(),
);
export const SetStaffServicesBody = registry.register(
  'SetStaffServicesBody',
  z.object({ serviceIds }).strict(),
);

export const StaffDto = registry.register(
  'StaffMember',
  z.object({
    id: z.string(),
    displayName: z.string(),
    bookable: z.boolean(),
    active: z.boolean(),
    role: RoleEnum.nullable(),
    serviceIds: z.array(z.string()),
  }),
);
export type StaffDtoT = z.infer<typeof StaffDto>;
export const StaffListDto = registry.register('StaffList', z.object({ staff: z.array(StaffDto) }));
export const StaffServicesDto = registry.register(
  'StaffServices',
  z.object({ serviceIds: z.array(z.string()) }),
);

/* ---------- working hours ---------- */
const hhmmStart = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (00:00 to 23:59).');
const hhmmEnd = z
  .string()
  .regex(/^(?:([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Use HH:mm (00:00 to 24:00).');
export const HoursIntervalSchema = z
  .object({ weekday: z.number().int().min(0).max(6), startLocal: hhmmStart, endLocal: hhmmEnd })
  .strict();
export const SetHoursBody = registry.register(
  'SetHoursBody',
  z.object({ intervals: z.array(HoursIntervalSchema).max(MAX_INTERVALS_TOTAL) }).strict(),
);
export const HoursDto = registry.register(
  'WorkingHours',
  z.object({ intervals: z.array(HoursIntervalSchema) }),
);

/* ---------- time off ---------- */
const reason = z.enum(['VACATION', 'SICK', 'OTHER']);
export const TimeOffListQuery = z.object({ includePast: flag.optional() }).strict();
export const CreateTimeOffBody = registry.register(
  'CreateTimeOffBody',
  z.object({ startAt: iso, endAt: iso, reason }).strict(),
);
export const TimeOffDto = registry.register(
  'TimeOff',
  z.object({ id: z.string(), startAt: z.string(), endAt: z.string(), reason }),
);
export const TimeOffListDto = registry.register(
  'TimeOffList',
  z.object({ items: z.array(TimeOffDto) }),
);

/* ---------- pending invites ---------- */
export const PendingInviteListDto = registry.register(
  'PendingInviteList',
  z.object({
    invites: z.array(
      z.object({ id: z.string(), email: z.string(), role: RoleEnum, expiresAt: z.string() }),
    ),
  }),
);

/* ---------- OpenAPI ---------- */
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorResponse) });
const security = [{ session: [] }];
const e = errorResponses;

registry.registerPath({
  method: 'get',
  path: '/api/business',
  summary: 'Business settings and setup progress',
  tags: ['setup'],
  security,
  responses: { 200: { description: 'Business', content: json(BusinessDto) }, 401: e[401] },
});
registry.registerPath({
  method: 'patch',
  path: '/api/business',
  summary: 'Update business settings (owner). slug and plan are not patchable',
  tags: ['setup'],
  security,
  request: { body: { content: json(UpdateBusinessBody) } },
  responses: {
    200: { description: 'Updated business', content: json(BusinessDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    409: err(
      'NOT_READY with `error.data.missing` (services, staff, hours) when `listed: true` is requested too early',
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/services',
  summary: 'List all services, ordered by sortOrder then name',
  tags: ['setup'],
  security,
  request: { query: ServiceListQuery },
  responses: {
    200: { description: 'Services', content: json(ServiceListDto) },
    400: e[400],
    401: e[401],
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/services',
  summary: 'Create a service (owner)',
  tags: ['setup'],
  security,
  request: { body: { content: json(CreateServiceBody) } },
  responses: {
    201: { description: 'Created', content: json(ServiceDto) },
    400: e[400],
    401: e[401],
    403: e[403],
  },
});
registry.registerPath({
  method: 'patch',
  path: '/api/services/{id}',
  summary: 'Update or (de)activate a service (owner). There is no delete',
  tags: ['setup'],
  security,
  request: { params: IdParams, body: { content: json(UpdateServiceBody) } },
  responses: {
    200: { description: 'Updated', content: json(ServiceDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/staff',
  summary: 'List staff members with their service ids',
  tags: ['setup'],
  security,
  responses: { 200: { description: 'Staff', content: json(StaffListDto) }, 401: e[401] },
});
registry.registerPath({
  method: 'post',
  path: '/api/staff',
  summary:
    'Create a staff member without a login (owner). 409 PLAN_LIMIT { limit, current } when Free already has its one active bookable member',
  tags: ['setup'],
  security,
  request: { body: { content: json(CreateStaffBody) } },
  responses: {
    201: { description: 'Created', content: json(StaffDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    409: err('PLAN_LIMIT'),
  },
});
registry.registerPath({
  method: 'patch',
  path: '/api/staff/{id}',
  summary:
    'Update a staff member (owner). 409 HAS_FUTURE_APPOINTMENTS when deactivating with future bookings; 409 PLAN_LIMIT when enabling bookable or reactivating beyond the plan',
  tags: ['setup'],
  security,
  request: { params: IdParams, body: { content: json(UpdateStaffBody) } },
  responses: {
    200: { description: 'Updated', content: json(StaffDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
    409: err('HAS_FUTURE_APPOINTMENTS or PLAN_LIMIT'),
  },
});
registry.registerPath({
  method: 'put',
  path: '/api/staff/{id}/services',
  summary: 'Replace the services a staff member performs (owner)',
  tags: ['setup'],
  security,
  request: { params: IdParams, body: { content: json(SetStaffServicesBody) } },
  responses: {
    200: { description: 'Replaced', content: json(StaffServicesDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/staff/{id}/hours',
  summary: 'Weekly working hours',
  tags: ['setup'],
  security,
  request: { params: IdParams },
  responses: { 200: { description: 'Hours', content: json(HoursDto) }, 401: e[401], 404: e[404] },
});
registry.registerPath({
  method: 'put',
  path: '/api/staff/{id}/hours',
  summary: 'Replace all working hours atomically (owner)',
  tags: ['setup'],
  security,
  request: { params: IdParams, body: { content: json(SetHoursBody) } },
  responses: {
    200: { description: 'Replaced', content: json(HoursDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/staff/{id}/time-off',
  summary: 'Time off (future and ongoing unless includePast=1)',
  tags: ['setup'],
  security,
  request: { params: IdParams, query: TimeOffListQuery },
  responses: {
    200: { description: 'Items', content: json(TimeOffListDto) },
    400: e[400],
    401: e[401],
    404: e[404],
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/staff/{id}/time-off',
  summary: 'Add time off (owner)',
  tags: ['setup'],
  security,
  request: { params: IdParams, body: { content: json(CreateTimeOffBody) } },
  responses: {
    201: { description: 'Created', content: json(TimeOffDto) },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
  },
});
registry.registerPath({
  method: 'delete',
  path: '/api/staff/{id}/time-off/{timeOffId}',
  summary: 'Remove time off (owner)',
  tags: ['setup'],
  security,
  request: { params: TimeOffParams },
  responses: {
    204: { description: 'Deleted' },
    400: e[400],
    401: e[401],
    403: e[403],
    404: e[404],
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/invites',
  summary: 'Pending (not accepted, not expired) invites (owner)',
  tags: ['invites'],
  security,
  responses: {
    200: { description: 'Pending invites', content: json(PendingInviteListDto) },
    401: e[401],
    403: e[403],
  },
});

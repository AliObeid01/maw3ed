import { z } from 'zod';
import { AREA_KEYS, CATEGORY_KEYS } from '@/lib/business/profile';
import { AppError, mapError, safeError, zodFields } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import { reportError } from '@/server/observability/report';
import { assistantService, type AssistantCtx, type AssistantService } from '@/server/services/assistant';
import { spend, type AssistantLimiter } from '@/server/services/assistantLimits';
import { rateLimiter } from '@/server/services/rateLimit';
import { quote } from './sanitize';

/**
 * The nine assistant tools, in a FIXED order (tools/list is deterministic). Descriptions are static, factual
 * and never contain business-entered text or instructions about how the model should behave. Inputs are
 * Zod `.strict()` schemas: unknown fields are rejected with an actionable (isError) result.
 */

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
}

export interface ToolRunContext extends AssistantCtx {
  service: AssistantService;
  limiter: AssistantLimiter;
  /** Filled while the tool runs, for the log line only. */
  business: { id?: string; slug?: string };
}

interface ToolDef<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  schema: S;
  annotations: ToolAnnotations;
  /** create_booking, join_waitlist, confirm_booking, cancel_booking: counted in the write bucket. */
  write: boolean;
  run: (
    args: z.output<S>,
    ctx: ToolRunContext,
  ) => Promise<{ summary: string; data: Record<string, unknown> }>;
}

const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const slug = z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z0-9-]+$/, 'Use the business slug, such as studio-nour.');
const id = z.string().trim().min(1).max(64);
const localDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-10.');
const personName = z.string().trim().min(1).max(80);
const phone = z.string().trim().min(3).max(32);
const email = z.string().trim().min(3).max(254);
const token = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .describe('The manage link from the confirmation email (it contains /l/...) or the token inside it.');

function define<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

const TOOLS = [
  define({
    name: 'search_businesses',
    title: 'Search businesses',
    description:
      'Searches the businesses listed on Maw3ed (salons, barbers, clinics, physiotherapists). Optional text, category and area filters. Returns up to 10 businesses with their slug, name, category, area, address, number of services, lowest price and the next free time. Reads only; nothing is booked.',
    schema: z
      .object({
        query: z.string().trim().max(80).optional(),
        category: z.enum(CATEGORY_KEYS).optional(),
        area: z.enum(AREA_KEYS).optional(),
        limit: z.number().int().min(1).max(10).optional(),
      })
      .strict(),
    annotations: READ,
    write: false,
    async run(args, ctx) {
      const data = await ctx.service.search(ctx, args);
      return {
        summary: `${data.businesses.length} listed business(es) found.`,
        data,
      };
    },
  }),
  define({
    name: 'get_business',
    title: 'Get business details',
    description:
      'Returns one listed business by slug: its services (id, name, duration, price, currency), its bookable staff (id, name, services they offer), its time zone and its booking page URL. Reads only.',
    schema: z.object({ slug }).strict(),
    annotations: READ,
    write: false,
    async run(args, ctx) {
      ctx.business.slug = args.slug;
      const data = await ctx.service.getBusiness(ctx, args.slug);
      return { summary: `Details of ${quote(data.business.name)}.`, data };
    },
  }),
  define({
    name: 'get_free_times',
    title: 'Get free times',
    description:
      'Lists free appointment start times for one service of a listed business, for up to 7 days starting at fromDate (default today, in the business time zone). Optional staffId. Each time has an ISO start with the local offset, a local label and the staff id when a person was chosen. Times can be taken by someone else before they are booked. Reads only.',
    schema: z
      .object({
        slug,
        serviceId: id,
        staffId: id.optional(),
        fromDate: localDate.optional(),
        days: z.number().int().min(1).max(7).optional(),
      })
      .strict(),
    annotations: READ,
    write: false,
    async run(args, ctx) {
      ctx.business.slug = args.slug;
      const data = await ctx.service.freeTimes(ctx, args);
      return {
        summary: `${data.total} free time(s) from ${data.from} to ${data.to} (${data.timezone}). Times can be taken before booking.`,
        data,
      };
    },
  }),
  define({
    name: 'prepare_booking',
    title: 'Prepare a booking',
    description:
      'Checks that a start time is currently offered for a service of a listed business and returns a summary (business, service, staff, local date and time, price) with a signed confirmationToken. The token is valid for 10 minutes and is required by create_booking. Nothing is booked and no client data is stored.',
    schema: z
      .object({
        slug,
        serviceId: id,
        staffId: id.optional(),
        startAt: z
          .string()
          .trim()
          .min(10)
          .max(40)
          .describe('Start time with its offset, as in get_free_times, e.g. 2026-11-11T18:30:00+02:00.'),
      })
      .strict(),
    annotations: READ,
    write: false,
    async run(args, ctx) {
      ctx.business.slug = args.slug;
      const data = await ctx.service.prepare(ctx, args);
      return {
        summary: `Prepared for ${data.summary.localLabel} (${data.summary.timezone}). Nothing is booked yet. The confirmation token expires in ${data.expiresInMinutes} minutes.`,
        data,
      };
    },
  }),
  define({
    name: 'create_booking',
    title: 'Create a booking',
    description:
      'Books the slot named by a valid confirmationToken, for the client name, phone and email given. Creates the appointment and the reminder emails. Repeating the same call returns the same booking. When the business asks for a deposit, returns a payUrl and the minutes the slot is held; payment is made on that web page and this tool takes no card data. Returns the reference code, local time, status and a manage link.',
    schema: z
      .object({
        confirmationToken: z
          .string()
          .trim()
          .min(10)
          .max(700)
          .describe('Signed token returned by prepare_booking; valid for 10 minutes.'),
        name: personName,
        phone,
        email,
      })
      .strict(),
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      const data = await ctx.service.createBooking(ctx, args);
      return {
        summary: `${data.alreadyBooked ? 'Already booked' : 'Booked'}: reference ${data.reference ?? 'n/a'}, ${data.localLabel} (${data.timezone}), status ${data.status}.`,
        data,
      };
    },
  }),
  define({
    name: 'join_waitlist',
    title: 'Join a waitlist',
    description:
      'Adds a client to the waitlist of a listed business for one service, between dateFrom and dateTo (yyyy-MM-dd, business time zone), with an optional staffId. If a matching time opens up, an email with a claim link is sent to the address given. Limited to 5 open entries per client.',
    schema: z
      .object({
        slug,
        serviceId: id,
        staffId: id.optional(),
        dateFrom: localDate,
        dateTo: localDate,
        name: personName,
        phone,
        email,
      })
      .strict(),
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      ctx.business.slug = args.slug;
      const data = await ctx.service.joinWaitlist(ctx, args);
      return {
        summary: data.alreadyOnWaitlist ? 'Already on the waitlist.' : 'Added to the waitlist.',
        data,
      };
    },
  }),
  define({
    name: 'get_booking',
    title: 'Get a booking',
    description:
      'Returns the status, local time, service, staff member and reference of a booking, from its manage link (the /l/... URL in the confirmation email) or the token inside it. Reads only.',
    schema: z.object({ token }).strict(),
    annotations: READ,
    write: false,
    async run(args, ctx) {
      const data = await ctx.service.linkView(ctx, args.token);
      return { summary: `Booking ${data.reference ?? ''} is ${data.status}.`.replace('  ', ' '), data };
    },
  }),
  define({
    name: 'confirm_booking',
    title: 'Confirm a booking',
    description:
      'Confirms a booking from its manage link or token. Confirming an already confirmed booking succeeds without change.',
    schema: z.object({ token }).strict(),
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      const data = await ctx.service.linkView(ctx, args.token, 'confirm');
      return { summary: String(data.resultMeaning ?? 'Done.'), data };
    },
  }),
  define({
    name: 'cancel_booking',
    title: 'Cancel a booking',
    description:
      "Cancels a booking from its manage link or token. The business's late-cancellation rule applies unchanged: a cancellation after the business cancel deadline is recorded as a late cancellation, and the result says which one happened.",
    schema: z.object({ token }).strict(),
    annotations: WRITE,
    write: true,
    async run(args, ctx) {
      const data = await ctx.service.linkView(ctx, args.token, 'cancel');
      return { summary: String(data.resultMeaning ?? 'Done.'), data };
    },
  }),
];

type AnyTool = (typeof TOOLS)[number];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export function listTools() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema, { target: 'draft-2020-12', io: 'input' }) as Record<
      string,
      unknown
    >;
    delete schema.$schema;
    return {
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: { ...schema, additionalProperties: false } as Record<string, unknown>,
      annotations: t.annotations,
    };
  });
}

export class UnknownToolError extends Error {
  constructor(readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
  }
}

const minutes = (sec: number) => Math.max(1, Math.ceil(sec / 60));

const errorResult = (text: string, data?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(data ? { structuredContent: data } : {}),
  isError: true,
});

/** Turn a thrown error into an actionable, never generic, tool result. */
export function toolErrorResult(error: unknown): { result: ToolResult; code: string } {
  const mapped = mapError(error);
  const e = mapped.body.error;
  const data = (e.data ?? {}) as { retryAfterSec?: number; freeTimes?: unknown; timezone?: string };
  if (mapped.unexpected || mapped.status >= 500) {
    if (e.code === 'SERVICE_BUSY' || e.code === 'SERVICE_UNAVAILABLE')
      return { result: errorResult(e.message, { code: e.code }), code: e.code };
    return {
      result: errorResult(
        'Maw3ed could not complete this right now. Try again in a minute. If it keeps failing, the client can book on the business page on the Maw3ed website.',
        { code: 'TEMPORARY_FAILURE' },
      ),
      code: 'TEMPORARY_FAILURE',
    };
  }
  switch (e.code) {
    case 'RATE_LIMITED':
    case 'TOO_MANY_ATTEMPTS': {
      const m = minutes(data.retryAfterSec ?? 60);
      return {
        result: errorResult(`Too many requests right now. Try again in ${m} minute${m === 1 ? '' : 's'}.`, {
          code: 'RATE_LIMITED',
          retryAfterMinutes: m,
        }),
        code: 'RATE_LIMITED',
      };
    }
    case 'SLOT_TAKEN':
      return {
        result: errorResult(
          `SLOT_TAKEN: ${e.message} Other free times are listed in freeTimes.`,
          { code: 'SLOT_TAKEN', ...data },
        ),
        code: 'SLOT_TAKEN',
      };
    case 'VALIDATION_FAILED': {
      const fields = Object.entries(e.fields)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ');
      return {
        result: errorResult(`Invalid input. ${fields || e.message}`, { code: e.code, fields: e.fields }),
        code: e.code,
      };
    }
    case 'NOT_FOUND':
      return { result: errorResult(`Not found. ${e.message}`, { code: e.code }), code: e.code };
    default:
      return { result: errorResult(e.message, { code: e.code }), code: e.code };
  }
}

function invalidInput(tool: AnyTool, error: z.ZodError): ToolResult {
  const fields = zodFields(error);
  const allowed = Object.keys(tool.schema.shape).join(', ');
  const detail = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v === 'Unknown field.' ? `Unknown field, remove it (allowed: ${allowed}).` : v}`)
    .join('; ');
  return errorResult(`Invalid input for ${tool.name}. ${detail}`, { code: 'VALIDATION_FAILED', fields });
}

export interface ToolCallDeps {
  requestId: string;
  logger: Logger;
  service?: AssistantService;
  limiter?: AssistantLimiter;
  /** Characters allowed in one tool result (Claude's limit is about 150,000). */
  maxChars?: number;
}

export const MAX_RESULT_CHARS = 100_000;

/**
 * Run one tool call: validate the arguments, spend the global budgets, run, log. The log line carries the tool
 * name, business id/slug, outcome, duration and request id. NEVER the arguments or the result.
 */
export async function callTool(
  name: string,
  rawArgs: unknown,
  deps: ToolCallDeps,
): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new UnknownToolError(name);
  const started = performance.now();
  const business: ToolRunContext['business'] = {};
  const service = deps.service ?? assistantService;
  const limiter = deps.limiter ?? rateLimiter;
  const ctx: ToolRunContext = {
    requestId: deps.requestId,
    logger: deps.logger,
    service,
    limiter,
    business,
    onBusiness: (businessId: string) => {
      business.id = businessId;
    },
  };
  let outcome = 'ok';
  let result: ToolResult;
  try {
    if (rawArgs !== undefined && (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)))
      throw AppError.validation({ arguments: 'Send the arguments as an object.' });
    const parsed = tool.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      outcome = 'invalid_input';
      result = invalidInput(tool, parsed.error);
    } else {
      await spend(limiter, 'mcpGlobal', 'all', 'open');
      if (tool.write) await spend(limiter, 'mcpWrite', 'all', 'closed');
      const out = await (tool as ToolDef<z.ZodObject>).run(parsed.data, ctx);
      const text = `${out.summary}\n${JSON.stringify(out.data)}`;
      result =
        text.length > (deps.maxChars ?? MAX_RESULT_CHARS)
          ? errorResult('The result was too large to return. Narrow the request (fewer days, a filter).')
          : { content: [{ type: 'text', text }], structuredContent: out.data };
      if (text.length > (deps.maxChars ?? MAX_RESULT_CHARS)) outcome = 'too_large';
    }
  } catch (error) {
    const mapped = toolErrorResult(error);
    outcome = mapped.code;
    result = mapped.result;
    if (mapOutcomeUnexpected(error)) deps.logger.error({ tool: name, err: safeError(error) }, 'mcp tool failed');
    if (mapOutcomeUnexpected(error)) reportError(error, { route: 'mcp:tools/call', requestId: deps.requestId, businessId: business.id });
  }
  deps.logger.info(
    {
      tool: name,
      businessId: business.id,
      slug: business.slug,
      outcome,
      durationMs: Math.round(performance.now() - started),
      requestId: deps.requestId,
    },
    'mcp tool call',
  );
  return result;
}

function mapOutcomeUnexpected(error: unknown): boolean {
  const m = mapError(error);
  return m.unexpected || m.status >= 500;
}

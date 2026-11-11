import { z } from 'zod';
import { ProposalSchema } from '@/server/domain/setupProposal';
import { AppError, mapError, safeError, zodFields } from '@/server/http/errors';
import type { Logger } from '@/server/http/logger';
import { reportError } from '@/server/observability/report';
import { spend, type AssistantLimiter } from '@/server/services/assistantLimits';
import type { OwnerActor } from '@/server/services/oauth';
import * as ownerSetup from '@/server/services/ownerSetup';
import { rateLimiter } from '@/server/services/rateLimit';
import { cleanText } from './sanitize';
import { toolErrorResult, UnknownToolError, type ToolAnnotations, type ToolResult } from './tools';

/**
 * The three OWNER tools of /api/mcp/owner. The business is ALWAYS the one in the token grant: no tool has a
 * businessId, slug or id argument, so a tool cannot even name another business. There is no tool that returns or
 * accepts clients, appointments, waitlist, pilot, payment, login or role data, and no tool that deletes.
 * Business-entered text in results is passed through sanitize.ts (data, not instructions).
 */
const MAX_RESULT_CHARS = 60_000;

interface OwnerToolDef<S extends z.ZodObject> {
  name: string;
  title: string;
  description: string;
  schema: S;
  annotations: ToolAnnotations;
  /** Per-grant budget spent before the tool runs (in addition to the per-grant call budget). */
  limit?: 'mcpOwnerPreview' | 'mcpOwnerApply';
  run: (
    args: z.output<S>,
    ctx: ownerSetup.OwnerCallCtx,
  ) => Promise<{ summary: string; data: Record<string, unknown> }>;
}

const define = <S extends z.ZodObject>(def: OwnerToolDef<S>) => def;

const TOOLS = [
  define({
    name: 'get_setup_status',
    title: 'Get setup status',
    description:
      "Returns how this business is set up right now: name, category, area, address, time slot, minimum notice and cancellation cutoff, the services (name, duration, price), the team members with the services they offer and a short summary of their weekly hours, and a checklist of what is still missing. It never returns clients or appointments. Reads only. Call this first, then ask the owner about anything missing instead of guessing.",
    schema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(_args, ctx) {
      const data = await ownerSetup.getStatus(ctx);
      return {
        summary: `Setup status of ${JSON.stringify(data.business.name)}: ${data.services.length} service(s), ${data.staff.length} team member(s), ${data.missing.length} item(s) missing.`,
        data,
      };
    },
  }),
  define({
    name: 'preview_setup_changes',
    title: 'Preview setup changes',
    description:
      'Checks a proposed setup against the business and shows exactly what would change, without saving anything to the business (it only stores a plan for 15 minutes). Provide only what the owner asked for: profile (category, area, address), settings (slotStepMin, minNoticeMin, cancelCutoffMin), services (name, durationMin, price), staff (name and the service names they offer) and hours (per person: weekdays 0=Sunday to 6=Saturday with start and end times in HH:mm; a weekday that is not listed is closed; hours replace the whole weekly pattern of that person). Do not invent values: ask the owner when something is missing. Services or people that already exist (same name, any letter case) are skipped and never changed. This tool cannot delete anything, and cannot change logins, plan, payments, listing, clients or appointments. It returns a planId; the plan lasts 15 minutes. Show the owner the preview and ask for their explicit approval before calling apply_setup_changes.',
    schema: ProposalSchema,
    // It stores a plan row (business setup data, 15 minutes), so it is not read-only.
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    limit: 'mcpOwnerPreview',
    async run(args, ctx) {
      const data = await ownerSetup.preview(ctx, args);
      return {
        summary: data.empty
          ? 'Nothing would change: everything in the proposal already exists or is already set.'
          : `Preview ready (${data.lines.length} change(s)). Nothing is saved yet. Show the owner the lines below and wait for their explicit approval before apply_setup_changes.`,
        data,
      };
    },
  }),
  define({
    name: 'apply_setup_changes',
    title: 'Apply setup changes',
    description:
      'Saves a previewed plan, all together or not at all. Call this ONLY after the owner has reviewed the preview from preview_setup_changes in this conversation and explicitly agreed to it. Takes the planId from the preview. Hours replace the whole weekly pattern of the people named. Calling it again with the same planId changes nothing and returns the original result. A plan expires after 15 minutes and works only for this connection. If something is wrong the plan is not partly applied: nothing changes. It cannot delete anything.',
    schema: z.object({ planId: z.string().trim().min(10).max(64) }).strict(),
    // Hours REPLACE a person's weekly pattern, so clients should ask before running it.
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    limit: 'mcpOwnerApply',
    async run(args, ctx) {
      const out = await ownerSetup.apply(ctx, args.planId);
      return {
        summary: out.alreadyApplied
          ? 'This plan was already applied. Nothing was changed again; here is the original result.'
          : 'Applied. The changes are saved.',
        data: { alreadyApplied: out.alreadyApplied, ...out.result },
      };
    },
  }),
];

type AnyTool = (typeof TOOLS)[number];

export const OWNER_TOOL_NAMES = TOOLS.map((t) => t.name);

export function listOwnerTools() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.schema, { target: 'draft-2020-12', io: 'input' }) as Record<string, unknown>;
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

const errorResult = (text: string, data?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text }],
  ...(data ? { structuredContent: data } : {}),
  isError: true,
});

function invalidInput(tool: AnyTool, error: z.ZodError): ToolResult {
  const fields = zodFields(error);
  const detail = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v === 'Unknown field.' ? 'Unknown field, remove it.' : v}`)
    .join('; ');
  return errorResult(`Invalid input for ${tool.name}. ${detail}`, { code: 'VALIDATION_FAILED', fields });
}

export interface OwnerToolDeps {
  requestId: string;
  logger: Logger;
  auth?: unknown;
  limiter?: AssistantLimiter;
}

/** Run one owner tool call: validate, spend the per-grant budgets, run, log (tool, business, grant, outcome only). */
export async function callOwnerTool(name: string, rawArgs: unknown, deps: OwnerToolDeps): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new UnknownToolError(name);
  const actor = deps.auth as OwnerActor | undefined;
  if (!actor?.businessId || !actor.grantId) throw new Error('owner tool called without an authenticated grant');
  const limiter = deps.limiter ?? rateLimiter;
  const started = performance.now();
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
      await spend(limiter, 'mcpOwnerCall', actor.grantId, 'open');
      if (tool.limit) await spend(limiter, tool.limit, actor.grantId, 'open');
      const out = await (tool as unknown as OwnerToolDef<z.ZodObject>).run(parsed.data, {
        actor,
        requestId: deps.requestId,
        logger: deps.logger,
      });
      // Sanitize every string of the result (business-entered text is untrusted data), then build the text.
      const data = cleanDeep(out.data) as Record<string, unknown>;
      const text = `${out.summary}\n${JSON.stringify(data)}`;
      if (text.length > MAX_RESULT_CHARS) {
        outcome = 'too_large';
        result = errorResult('The result was too large to return.');
      } else result = { content: [{ type: 'text', text }], structuredContent: data };
    }
  } catch (error) {
    const mapped = toolErrorResult(error);
    outcome = mapped.code;
    result = mapped.result;
    const m = mapError(error);
    if (m.unexpected || m.status >= 500) {
      deps.logger.error({ tool: name, err: safeError(error) }, 'mcp owner tool failed');
      reportError(error, { route: 'mcp-owner:tools/call', requestId: deps.requestId, businessId: actor.businessId });
    }
  }
  deps.logger.info(
    {
      tool: name,
      businessId: actor.businessId,
      grantId: actor.grantId,
      outcome,
      durationMs: Math.round(performance.now() - started),
      requestId: deps.requestId,
    },
    'mcp owner tool call',
  );
  return result;
}

/** Clean every string leaf with the same rules as business-entered names (planIds and ISO dates survive unchanged). */
function cleanDeep(value: unknown): unknown {
  if (typeof value === 'string') return cleanText(value, 400);
  if (Array.isArray(value)) return value.map(cleanDeep);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cleanDeep(v)]));
  return value;
}

import { z } from 'zod';

/** Same origin in production. A different base is only for local testing against a throwaway mock server. */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

// ---- Response schemas (tolerant: unknown extra keys are ignored on the way in) -------------

const userSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
const businessSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  timezone: z.string(),
});
export const sessionSchema = z.object({
  user: userSchema,
  business: businessSchema,
  role: z.string(),
});
export const slugCheckSchema = z.object({
  available: z.boolean(),
  reason: z.enum(['invalid', 'reserved', 'taken']).optional(),
});
export const inviteSchema = z.object({
  businessName: z.string(),
  email: z.string(),
  role: z.string(),
  expiresAt: z.string(),
});
const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string().optional(),
    fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    data: z.unknown().optional(),
  }),
});

export type Session = z.infer<typeof sessionSchema>;
export type SlugCheck = z.infer<typeof slugCheckSchema>;
export type Invite = z.infer<typeof inviteSchema>;

// ---- Errors --------------------------------------------------------------------------------

/** `NETWORK` and `BAD_RESPONSE` are client-side codes; everything else comes from the error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** One message per field name (first message when the server sends a list). */
    readonly fields: Record<string, string> = {},
    /** Machine-readable extras from `error.data`, e.g. `{ slots }` for SLOT_TAKEN. Validate before use. */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Reads `{ error: { code, message, fields? } }`; anything else becomes a generic `HTTP_<status>` error. */
export function parseErrorBody(status: number, body: unknown): ApiError {
  const parsed = errorEnvelopeSchema.safeParse(body);
  if (!parsed.success) return new ApiError(status, `HTTP_${status}`, `Request failed (${status})`);
  const { code, message, fields, data } = parsed.data.error;
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) flat[name] = first;
  }
  return new ApiError(status, code, message ?? code, flat, data);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

export async function request<S extends z.ZodType>(
  path: string,
  schema: S,
  init: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
    /** Extra request headers, e.g. `Idempotency-Key`. */
    headers?: Record<string, string>;
  } = {},
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  const json = await readJson(res);
  if (!res.ok) throw parseErrorBody(res.status, json);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiError(res.status, 'BAD_RESPONSE', 'Unexpected response');
  return parsed.data;
}

// ---- Endpoints -----------------------------------------------------------------------------

export type SignupBody = {
  businessName: string;
  slug: string;
  timezone: string;
  ownerName: string;
  email: string;
  password: string;
};

export const signup = (body: SignupBody) =>
  request('/api/auth/signup', sessionSchema, { method: 'POST', body });

export const login = (body: { email: string; password: string }) =>
  request('/api/auth/login', sessionSchema, { method: 'POST', body });

export const checkSlug = (slug: string, signal?: AbortSignal) =>
  request(`/api/auth/slug-check?slug=${encodeURIComponent(slug)}`, slugCheckSchema, { signal });

export const getInvite = (token: string, signal?: AbortSignal) =>
  request(`/api/invites/${encodeURIComponent(token)}`, inviteSchema, { signal });

export const acceptInvite = (token: string, body: { name: string; password: string }) =>
  request(`/api/invites/${encodeURIComponent(token)}/accept`, sessionSchema, {
    method: 'POST',
    body,
  });

export const logout = () => request('/api/auth/logout', z.unknown(), { method: 'POST' });

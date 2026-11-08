import type { ZodError } from 'zod';

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'SLOT_TAKEN'
  | 'CONFLICT'
  | 'LINK_EXPIRED'
  | 'OFFER_EXPIRED'
  | 'SERVICE_UNAVAILABLE'
  | 'NOT_IMPLEMENTED'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'RATE_LIMITED'
  | 'SERVICE_BUSY'
  | 'INTERNAL'
  | (string & {});

export type Fields = Record<string, string>;

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    fields: Fields;
    /** Extra machine-readable payload, e.g. `{ slots }` for SLOT_TAKEN. */
    data?: unknown;
  };
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields: Fields;
  readonly data?: unknown;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fields: Fields = {},
    data?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.data = data;
  }

  static validation(fields: Fields, message = 'Some fields are invalid.') {
    return new AppError(400, 'VALIDATION_FAILED', message, fields);
  }
  static unauthenticated(message = 'Sign in to continue.') {
    return new AppError(401, 'UNAUTHENTICATED', message);
  }
  static forbidden(message = 'You are not allowed to do that.') {
    return new AppError(403, 'FORBIDDEN', message);
  }
  /** Also used for ids that belong to another business: never reveal that they exist. */
  static notFound(message = 'Not found.') {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(
    code: ErrorCode = 'CONFLICT',
    data?: unknown,
    message = 'The request conflicts with the current state.',
  ) {
    return new AppError(409, code, message, {}, data);
  }
  /** Login and invite-accept failures: one message for wrong email and wrong password. */
  static invalidCredentials() {
    return new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
  }
  static tooManyAttempts(retryAfterSec: number) {
    return new AppError(
      429,
      'TOO_MANY_ATTEMPTS',
      'Too many attempts. Try again later.',
      {},
      { retryAfterSec },
    );
  }
  /** Per-IP route limits (platform rate limiting). Same envelope as everything else. */
  static rateLimited(retryAfterSec: number) {
    return new AppError(
      429,
      'RATE_LIMITED',
      'Too many requests. Try again later.',
      {},
      { retryAfterSec },
    );
  }
  /**
   * Soft e-mail verification: the account works, but inviting staff and listing in the directory need a
   * confirmed address. A state precondition (like NOT_READY), so 409 rather than 403.
   */
  static emailNotVerified() {
    return new AppError(
      409,
      'EMAIL_NOT_VERIFIED',
      'Verify your email address first. Use "Resend email" in your dashboard if you need a new link.',
    );
  }
  static gone(code: ErrorCode = 'LINK_EXPIRED', message = 'This link has expired.') {
    return new AppError(410, code, message);
  }
  static payloadTooLarge(message = 'Request body is too large.') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', message);
  }
  static unavailable(message = 'Service temporarily unavailable.') {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
  /** Too many password hashes in flight on this instance. */
  static busy(retryAfterSec = 2) {
    return new AppError(
      503,
      'SERVICE_BUSY',
      'The server is busy. Try again in a moment.',
      {},
      { retryAfterSec },
    );
  }
  static notImplemented(message = 'Not implemented yet.') {
    return new AppError(501, 'NOT_IMPLEMENTED', message);
  }
}

/** Zod issues to a flat `{ "path.to.field": "message" }` map. Root-level issues use `_`. */
export function zodFields(error: ZodError): Fields {
  const fields: Fields = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join('.') || '_';
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys)
        fields[path === '_' ? key : `${path}.${key}`] = 'Unknown field.';
      continue;
    }
    fields[path] ??= issue.message;
  }
  return fields;
}

const PG_CODE = /^[0-9][0-9A-Z]{4}$/;

/**
 * Find a Postgres SQLSTATE on a thrown value. Depending on the Prisma path (typed client, `$queryRaw`,
 * driver adapter) it may sit on `code`, `meta.code`, `meta.driverAdapterError.cause.originalCode`
 * or on a nested `cause`, so walk the likely places.
 */
export function pgErrorCode(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 5) return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ['code', 'originalCode', 'sqlState']) {
    const v = e[key];
    if (typeof v === 'string' && PG_CODE.test(v) && !/^P\d{4}$/.test(v)) return v;
  }
  for (const key of ['meta', 'driverAdapterError', 'cause']) {
    const found = pgErrorCode(e[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * A transient lock failure whose transaction Postgres has already rolled back: 40P01 (deadlock detected, this
 * statement was the victim) and 55P03 (lock not available). Retrying the WHOLE transaction is safe; retrying
 * inside the aborted one is not. The slot constraint (23P01) and unique violations are NOT retryable here.
 */
export function isRetryableLockError(error: unknown): boolean {
  const pg = pgErrorCode(error);
  return pg === '40P01' || pg === '55P03';
}

/**
 * Every constraint / index / column name a unique-violation error mentions. Depending on the Prisma path
 * they sit in `meta.target`, `meta.driverAdapterError.cause.constraint` (`{ index }` or `{ fields }`) or a
 * plain pg `constraint`, so walk the likely places. Used to tell WHICH unique rule fired (a booking reference
 * collision is retried; the idempotency key and the slot constraint are not).
 */
export function violatedNames(error: unknown, depth = 0, out: string[] = []): string[] {
  if (!error || typeof error !== 'object' || depth > 6) return out;
  const e = error as Record<string, unknown>;
  for (const key of ['constraint', 'target', 'fields', 'index']) {
    const v = e[key];
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') out.push(x);
    }
  }
  for (const key of ['meta', 'driverAdapterError', 'cause', 'constraint'])
    if (e[key] && typeof e[key] === 'object') violatedNames(e[key], depth + 1, out);
  return out;
}

function prismaCode(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const c = (error as { code?: unknown }).code;
    if (typeof c === 'string' && /^P\d{4}$/.test(c)) return c;
  }
  return undefined;
}

/**
 * Translate database errors to AppErrors. 23P01 (exclusion) means the slot was taken; the booking service
 * adds fresh slots to `data` before it reaches the client.
 */
export function fromDbError(error: unknown): AppError | undefined {
  const pg = pgErrorCode(error);
  if (pg === '23P01')
    return AppError.conflict(
      'SLOT_TAKEN',
      { slots: [] },
      'That time was just taken. Pick another.',
    );
  // 40P01 deadlock detected, 55P03 lock not available: transient, the client may retry (F36 row locks).
  if (pg === '40P01' || pg === '55P03') return AppError.busy();
  if (pg === '23505' || prismaCode(error) === 'P2002') return AppError.conflict('CONFLICT');
  if (prismaCode(error) === 'P2025') return AppError.notFound();
  return undefined;
}

/** Log-safe view of an error: name, code and message only. */
export function safeError(error: unknown): { name?: string; code?: string; message?: string } {
  if (!error || typeof error !== 'object') return { message: String(error) };
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  return {
    name: typeof e.name === 'string' ? e.name : undefined,
    code: typeof e.code === 'string' ? e.code : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
  };
}

export function toAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) return error;
  return fromDbError(error);
}

export function errorBody(error: AppError): ErrorBody {
  const body: ErrorBody = {
    error: { code: error.code, message: error.message, fields: error.fields },
  };
  if (error.data !== undefined) body.error.data = error.data;
  return body;
}

export interface MappedError {
  status: number;
  body: ErrorBody;
  /** True when the error was not an expected AppError (log it, report it). */
  unexpected: boolean;
  /** Extra response headers (Retry-After on 429). */
  headers?: Record<string, string>;
}

export function mapError(error: unknown): MappedError {
  const known = toAppError(error);
  if (known) {
    const retry = (known.data as { retryAfterSec?: unknown } | undefined)?.retryAfterSec;
    return {
      status: known.status,
      body: errorBody(known),
      unexpected: false,
      ...((known.status === 429 || known.status === 503) && typeof retry === 'number'
        ? { headers: { 'Retry-After': String(retry) } }
        : {}),
    };
  }
  return {
    status: 500,
    body: errorBody(new AppError(500, 'INTERNAL', 'Something went wrong.')),
    unexpected: true,
  };
}

/**
 * Central scrubbing for error monitoring (NFR-04 / privacy). Pure: no I/O, no SDK import, no Date.now().
 * Everything that leaves the process for the error service passes through `beforeSend` / `beforeBreadcrumb`.
 * Fail closed: if scrubbing throws, the event is dropped, never sent half-scrubbed.
 */

const MAX_STRING = 2000;
const MAX_DEPTH = 10;
const MAX_ITEMS = 100;
const MAX_KEYS = 100;

export const REDACTED = '[redacted]';
const EMAIL_MARK = '[email]';
const PHONE_MARK = '[phone]';
const TOKEN_MARK = '[token]';

// Values under keys like these are never sent, whatever they contain.
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|authori[sz]ation|cookie|csrf|api[-_]?key|token|session|credential|otp|phone|e-?mail/i;

// `password=hunter2`, `authorization: Bearer abc`, `"secret":"x"` inside a message.
const KEY_VALUE =
  /\b(pass(?:word|wd)?|secret|authori[sz]ation|api[-_]?key|cookie|csrf[-_]?token|msisdn)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|(?:Bearer\s+)?[^\s,;&]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/g;

// Unicode local part and domain (Arabic names, IDNs); encoded at signs are decoded first.
const EMAIL = /[\p{L}\p{N}._%+'-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const ENCODED_AT = /%40|&#0*64;|&#x0*40;|&commat;/gi;
// Postgres unique-violation detail: `Key (email)=(rana@x.com) already exists`. Keep the column names, drop the values.
const PG_KEY_DETAIL = /\bKey \(([^)]*)\)=\([^)]*\)/g;
// Click-to-chat and tel links: the number follows the marker.
const PHONE_LINK =
  /(wa\.me\/|whatsapp\.com\/send\?phone=|[?&]phone=|\btel:)\+?[0-9\u0660-\u0669\u06F0-\u06F9][0-9\u0660-\u0669\u06F0-\u06F9 ()._-]{5,}[0-9\u0660-\u0669\u06F0-\u06F9]/gi;

// Link pages whose last-but-one path segment is a bearer token (`/o/[token]/leave` keeps `/leave`).
const TOKEN_ROUTE =
  /(\/(?:l|o|pay|invite|verify-email|reset-password|api\/(?:links|offers|invites|pay))\/)(?![[\]])[^/\s?#"'<>)\]]+/g;

// A path or absolute URL followed by a query string: keep the path, drop `?...`.
const URL_WITH_QUERY = /(https?:\/\/[^\s?#"'<>]+|\/[^\s?#"'<>]*)\?[^\s#"'<>]*/g;

const OPAQUE = /[A-Za-z0-9_-]{32,}/g;
// A signed link token is `body.signature`: both halves are long even when neither reaches 32 characters.
const TOKEN_PAIR = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Western, Arabic-Indic and Persian digits.
const D = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const PHONE_CANDIDATE = new RegExp(
  `(?<![\\p{L}\\p{N}_$\\u20AC\\u00A3])(\\+?${D}[${'0-9\\u0660-\\u0669\\u06F0-\\u06F9'} \\u00A0().\\/-]{5,18}${D})(?![\\p{L}\\p{N}_])`,
  'gu',
);

function asciiDigits(value: string): string {
  let out = '';
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x30 && c <= 0x39) out += ch;
    else if (c >= 0x660 && c <= 0x669) out += String(c - 0x660);
    else if (c >= 0x6f0 && c <= 0x6f9) out += String(c - 0x6f0);
  }
  return out;
}

function looksLikePhone(candidate: string): boolean {
  const digits = asciiDigits(candidate);
  if (candidate.startsWith('+')) return digits.length >= 8 && digits.length <= 15;
  const plain = candidate.replace(/[٠-٩۰-۹]/g, '0');
  // Dates (2026-11-08, 08/11/2026) are not phone numbers.
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(plain)) return false;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(plain)) return false;
  if (/^00\d{8,15}$/.test(digits)) return true;
  if (/^961\d{7,8}$/.test(digits)) return true;
  // Lebanese national format: 0X + 6 digits (03, 01, ...), or the mobile prefixes 70-79 / 81 + 6 digits.
  if (digits.length === 8 && /^(0[1-9]|7\d|81)/.test(digits)) return true;
  // Mobile without the trunk zero, grouped: 3 123 456.
  if (digits.length === 7 && /^[3-9]( |-)\d{3}( |-)\d{3}$/.test(plain)) return true;
  // Other countries without a plus, grouped: 44 20 7946 0958.
  return digits.length >= 11 && digits.length <= 15 && /[ -]/.test(plain);
}

/** Replace the personal data and secrets in a free-text string. Never throws. */
export function scrubString(input: string): string {
  try {
    let s = input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}...` : input;
    s = s.replace(PG_KEY_DETAIL, 'Key ($1)=([redacted])');
    s = s.replace(ENCODED_AT, '@');
    s = s.replace(PHONE_LINK, `$1${PHONE_MARK}`);
    s = s.replace(KEY_VALUE, `$1$2${REDACTED}`);
    s = s.replace(BEARER, `Bearer ${REDACTED}`);
    s = s.replace(EMAIL, EMAIL_MARK);
    s = s.replace(URL_WITH_QUERY, '$1');
    s = s.replace(TOKEN_ROUTE, `$1${TOKEN_MARK}`);
    s = s.replace(TOKEN_PAIR, TOKEN_MARK);
    s = s.replace(OPAQUE, (m) => (UUID.test(m) ? m : TOKEN_MARK));
    s = s.replace(PHONE_CANDIDATE, (m) => (looksLikePhone(m) ? PHONE_MARK : m));
    return s;
  } catch {
    return REDACTED;
  }
}

/** A URL or path: no query string, no fragment, token segments templated. */
export function scrubUrl(url: string): string {
  try {
    const cut = url.search(/[?#]/);
    return scrubString(cut === -1 ? url : url.slice(0, cut));
  } catch {
    return '';
  }
}

/** Deep copy with strings scrubbed and sensitive keys redacted. Bounded depth and size; cycle safe; never throws. */
export function scrubValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  try {
    switch (typeof value) {
      case 'string':
        return scrubString(value);
      case 'number':
      case 'boolean':
      case 'undefined':
        return value;
      case 'bigint':
        return String(value);
      case 'function':
      case 'symbol':
        return undefined;
    }
    if (value === null) return null;
    const obj = value as object;
    if (depth >= MAX_DEPTH) return '[truncated]';
    if (seen.has(obj)) return '[circular]';
    if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? null : obj.toISOString();
    seen.add(obj);
    if (obj instanceof Error) {
      return { name: obj.name, message: scrubString(String(obj.message)) };
    }
    if (Array.isArray(obj)) {
      const out = obj.slice(0, MAX_ITEMS).map((item) => scrubValue(item, depth + 1, seen));
      if (obj.length > MAX_ITEMS) out.push(`[+${obj.length - MAX_ITEMS} more]`);
      return out;
    }
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const key of Object.keys(obj)) {
      if (key === '__proto__') continue;
      if (++n > MAX_KEYS) break;
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED;
        continue;
      }
      let child: unknown;
      try {
        child = (obj as Record<string, unknown>)[key];
      } catch {
        out[key] = '[unreadable]';
        continue;
      }
      out[key] = scrubValue(child, depth + 1, seen);
    }
    return out;
  } catch {
    return '[unreadable]';
  }
}

// ---------------------------------------------------------------- events

export interface FrameLike {
  filename?: string;
  abs_path?: string;
  function?: string;
  module?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  platform?: string;
  vars?: unknown;
}
export interface ExceptionLike {
  type?: string;
  value?: string;
  mechanism?: { type?: string; handled?: boolean } & object;
  stacktrace?: { frames?: FrameLike[] };
}
export interface BreadcrumbLike {
  type?: string;
  level?: string;
  category?: string;
  message?: string;
  timestamp?: number;
  data?: unknown;
}
export interface RequestLike {
  url?: string;
  method?: string;
  headers?: Record<string, unknown>;
  query_string?: unknown;
  cookies?: unknown;
  data?: unknown;
  env?: unknown;
}
export interface EventLike {
  message?: string;
  logentry?: { message?: string; params?: unknown };
  user?: unknown;
  server_name?: string;
  transaction?: string;
  request?: RequestLike;
  exception?: { values?: ExceptionLike[] };
  breadcrumbs?: BreadcrumbLike[];
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
}

// Top-level fields copied as they are: identifiers we or the SDK set, never user content.
const PASS_THROUGH = new Set([
  'event_id',
  'timestamp',
  'platform',
  'level',
  'release',
  'environment',
  'type',
  'fingerprint',
]);
const DROPPED = new Set(['user', 'server_name', 'modules', 'debug_meta', 'spans', 'measurements']);

const NOISE_TEXT: RegExp[] = [
  /ResizeObserver loop/i,
  /Non-Error promise rejection captured/i,
  /Object captured as exception with keys/i,
  /NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|NEXT_UNAUTHORIZED|NEXT_FORBIDDEN/,
  /The user aborted a request/i,
  /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i,
];
const EXTENSION_URL = /^(chrome|moz|safari|safari-web)-extension:\/\//i;

/** Errors that are control flow or browser noise, never worth a report. */
export function isNoiseEvent(event: EventLike): boolean {
  const values = event.exception?.values ?? [];
  const texts = [
    event.message,
    ...values.flatMap((v) => [v.value, `${v.type ?? ''}: ${v.value ?? ''}`]),
  ];
  for (const v of values) {
    if (v.type === 'AbortError' || /^AbortError\b/.test(v.value ?? '')) return true;
    const digest = (v as { digest?: unknown }).digest;
    if (typeof digest === 'string' && /^NEXT_(REDIRECT|NOT_FOUND|HTTP_ERROR_FALLBACK)/.test(digest))
      return true;
  }
  if (texts.some((t) => typeof t === 'string' && NOISE_TEXT.some((re) => re.test(t)))) return true;
  // Only browser-extension frames: not our code.
  const frames = values.flatMap((v) => v.stacktrace?.frames ?? []);
  const named = frames.filter((f) => f.filename || f.abs_path);
  return named.length > 0 && named.every((f) => EXTENSION_URL.test(f.filename ?? f.abs_path ?? ''));
}

export function scrubBreadcrumb<B extends BreadcrumbLike>(crumb: B): B | null {
  try {
    if (crumb.category === 'navigation') {
      const out: BreadcrumbLike = { category: 'navigation' };
      if (crumb.timestamp !== undefined) out.timestamp = crumb.timestamp;
      return out as B;
    }
    return null;
  } catch {
    return null;
  }
}

const MAX_EXCEPTION_VALUE = 500;
const DB_ERROR_NAME = /^(PrismaClient\w*|DriverAdapterError|\w*DatabaseError)$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** `Name CODE (col1,col2)`: the class, the code and column names; never a value, a query or a parameter. */
function dbSummary(name: string, code: string | undefined, columns: string[]): string {
  const cols = columns.filter((c) => IDENT.test(c)).slice(0, 8);
  return `${name}${code ? ` ${code}` : ''}${cols.length ? ` (${cols.join(',')})` : ''}`;
}
const columnsFromMessage = (message: string): string[] => {
  const m = /fields?:\s*\(([^)]*)\)/.exec(message);
  return m ? [...m[1]!.matchAll(/`(\w+)`/g)].map((x) => x[1]!) : [];
};
const codeFromMessage = (message: string): string | undefined => /\b(P\d{4})\b/.exec(message)?.[1];

function scrubExceptionValue(type: string | undefined, value: string): string {
  // Already reduced by sanitizeError: `Name CODE (cols)`.
  if (type && value.startsWith(type) && /^\w+( [A-Za-z0-9]{4,6})?( \([\w,]+\))?$/.test(value))
    return value;
  if (type && DB_ERROR_NAME.test(type))
    return dbSummary(type, codeFromMessage(value), columnsFromMessage(value));
  const clean = scrubString(value);
  return clean.length > MAX_EXCEPTION_VALUE ? `${clean.slice(0, MAX_EXCEPTION_VALUE)}...` : clean;
}

function isDbError(e: Record<string, unknown>): boolean {
  const name = typeof e.name === 'string' ? e.name : '';
  return (
    DB_ERROR_NAME.test(name) ||
    (typeof e.code === 'string' && ('detail' in e || 'routine' in e || 'severity' in e))
  );
}

/**
 * Before an error object is handed to the SDK: Prisma and pg errors embed row values (validation arguments,
 * `detail`, `query`, `parameters`). Replace them with a fresh error that has the class name, the code and the
 * column names only, plus the original stack frames. Anything else is returned as is.
 */
export function sanitizeError(error: unknown): unknown {
  try {
    if (!error || typeof error !== 'object') return error;
    const e = error as Record<string, unknown>;
    if (!isDbError(e)) return error;
    const name = typeof e.name === 'string' && e.name ? e.name : 'DatabaseError';
    const message = typeof e.message === 'string' ? e.message : '';
    const rawCode =
      typeof e.code === 'string' && /^[A-Za-z0-9]{4,6}$/.test(e.code) ? e.code : undefined;
    const target = (e.meta as { target?: unknown } | undefined)?.target;
    const metaCols = (
      Array.isArray(target) ? target : typeof target === 'string' ? [target] : []
    ).filter((c): c is string => typeof c === 'string');
    const safe = new Error(
      dbSummary(
        name,
        rawCode ?? codeFromMessage(message),
        metaCols.length ? metaCols : columnsFromMessage(message),
      ),
    );
    safe.name = name;
    const frames =
      typeof e.stack === 'string' ? e.stack.split('\n').filter((l) => /^\s+at /.test(l)) : [];
    safe.stack = [`${name}: ${safe.message}`, ...frames].join('\n');
    return safe;
  } catch {
    return new Error('DatabaseError');
  }
}

const MAX_CODE_PATH = 500;
const WIN_HOME = /\b([A-Za-z]):[\\/]+Users[\\/]+[^\\/\s]+/g;
const POSIX_HOME = /(^|[\s(])\/(?:Users|home)\/[^/\s)]+/g;
const SIGNED_SEGMENT = /(^|[/\\])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}(?=$|[/\\])/g;

/**
 * Narrow sanitiser for stack-frame location fields only (filename, abs_path, module, function).
 * Keeps code paths readable (pnpm folders like `next@16.4.3_@babel+core@...`, chunk names): it only strips
 * query/fragment, OS home directories, signed tokens and secret-link segments, and caps the length.
 * Never use it for messages, tags, breadcrumbs, extra, request or contexts.
 */
export function sanitizeCodePath(input: string): string {
  try {
    let s = input;
    const cut = s.search(/[?#]/);
    if (cut !== -1) s = s.slice(0, cut);
    if (/^[A-Za-z]:\\/.test(s)) s = s.replace(/\\/g, '/');
    s = s.replace(WIN_HOME, '$1:/Users/[user]');
    s = s.replace(POSIX_HOME, '$1/[user]');
    s = s.replace(SIGNED_SEGMENT, `$1${TOKEN_MARK}`);
    s = s.replace(TOKEN_ROUTE, `$1${TOKEN_MARK}`);
    return s.length > MAX_CODE_PATH ? `${s.slice(0, MAX_CODE_PATH)}...` : s;
  } catch {
    return REDACTED;
  }
}

function scrubException(v: ExceptionLike): ExceptionLike {
  const out: ExceptionLike = {};
  if (typeof v.type === 'string') out.type = scrubString(v.type);
  if (typeof v.value === 'string') out.value = scrubExceptionValue(v.type, v.value);
  if (v.mechanism) out.mechanism = { type: v.mechanism.type, handled: v.mechanism.handled };
  const frames = v.stacktrace?.frames;
  if (Array.isArray(frames)) {
    out.stacktrace = {
      frames: frames.slice(-50).map((f) => {
        const fr: FrameLike = {};
        if (typeof f.filename === 'string') fr.filename = sanitizeCodePath(f.filename);
        if (typeof f.abs_path === 'string') fr.abs_path = sanitizeCodePath(f.abs_path);
        if (typeof f.function === 'string') fr.function = sanitizeCodePath(f.function);
        if (typeof f.module === 'string') fr.module = sanitizeCodePath(f.module);
        if (typeof f.lineno === 'number') fr.lineno = f.lineno;
        if (typeof f.colno === 'number') fr.colno = f.colno;
        if (typeof f.in_app === 'boolean') fr.in_app = f.in_app;
        if (typeof f.platform === 'string') fr.platform = f.platform;
        return fr; // `vars`, `data` and source context lines (context_line, pre_context, post_context) are never copied
      }),
    };
  }
  return out;
}

/** A scrubbed copy of the event (the input is not mutated). May throw: use `beforeSend`. */
export function scrubEvent<T extends EventLike>(event: T): T | null {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(event)) {
    const value = (event as Record<string, unknown>)[key];
    if (DROPPED.has(key)) continue;
    if (PASS_THROUGH.has(key)) {
      out[key] = value;
      continue;
    }
    switch (key) {
      case 'message':
        out.message = typeof value === 'string' ? scrubString(value) : undefined;
        break;
      case 'logentry': {
        const l = value as { message?: unknown } | undefined;
        out.logentry = {
          message: typeof l?.message === 'string' ? scrubString(l.message) : undefined,
        };
        break;
      }
      case 'transaction':
        out.transaction = typeof value === 'string' ? scrubUrl(value) : undefined;
        break;
      case 'request': {
        const r = value as RequestLike;
        const req: RequestLike = {};
        if (typeof r.url === 'string') req.url = scrubUrl(r.url);
        if (typeof r.method === 'string') req.method = r.method;
        // Cookies, authorization, x-cron-secret, x-csrf-*, referer, body, query string, env: none are kept.
        const ua = r.headers?.['user-agent'] ?? r.headers?.['User-Agent'];
        if (typeof ua === 'string') req.headers = { 'user-agent': scrubString(ua) };
        out.request = req;
        break;
      }
      case 'exception': {
        const values = (value as { values?: ExceptionLike[] }).values;
        out.exception = { values: Array.isArray(values) ? values.map(scrubException) : [] };
        break;
      }
      case 'breadcrumbs': {
        const list = Array.isArray(value) ? (value as BreadcrumbLike[]) : [];
        out.breadcrumbs = list
          .map((b) => scrubBreadcrumb(b))
          .filter((b): b is BreadcrumbLike => b !== null)
          .slice(-30);
        break;
      }
      case 'sdk': {
        // Defence in depth next to sendDefaultPii:false: the server must not infer the visitor's IP address.
        const sdk = (value && typeof value === 'object' ? value : {}) as { settings?: object };
        out.sdk = { ...sdk, settings: { ...sdk.settings, infer_ip: 'never' } };
        break;
      }
      case 'contexts': {
        // The trace/span ids are random identifiers, not content; everything else is scrubbed.
        const { trace, ...rest } = (value && typeof value === 'object' ? value : {}) as {
          trace?: unknown;
        };
        out.contexts = {
          ...(scrubValue(rest) as object),
          ...(trace === undefined ? {} : { trace }),
        };
        break;
      }
      default:
        out[key] = scrubValue(value);
    }
  }
  return out as T;
}

/** SDK `beforeSend`: noise is dropped, everything else scrubbed; any failure drops the event. */
export function beforeSend<T extends EventLike>(event: T): T | null {
  try {
    if (isNoiseEvent(event)) return null;
    return scrubEvent(event);
  } catch {
    return null;
  }
}

/** SDK `beforeBreadcrumb`. */
export function beforeBreadcrumb<B extends BreadcrumbLike>(crumb: B): B | null {
  return scrubBreadcrumb(crumb);
}

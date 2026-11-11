/**
 * The `next` parameter of /login (where to go after signing in) is attacker-controlled input, so it is checked
 * against a strict whitelist instead of a blacklist of known payloads. A value passes only when it is a
 * same-origin dashboard path: one `/`, the prefix `/app/`, and nothing but plain path/query characters.
 * No `%` (so no encoded `//`, `\` or CRLF), no backslash, no whitespace or control characters, no `..` / `.`
 * segments, no fragment, no scheme, no second `?`, at most MAX_NEXT characters.
 */
const MAX_NEXT = 200;
const PREFIX = '/app/';
const SAFE_CHARS = /^[A-Za-z0-9/_\-.?=&]+$/;

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

// The ONE non-dashboard destination: the owner connector's consent page, so a signed-out owner returns to the exact
// authorization request after signing in. The prefix is a fixed literal path + `?`, so whatever follows is only a query
// string and the target can never leave this origin. The query is percent-encoded by us, so `%`, `+` and `:` are allowed
// there, but no literal `/` after `//`, no fragment, no whitespace, no backslash, no control characters.
const OAUTH_PREFIX = '/oauth/authorize?';
const OAUTH_QUERY = /^[A-Za-z0-9_\-.~%=&+:*!/]+$/;
const MAX_OAUTH_NEXT = 1500;

function safeOauthNext(value: string): string | null {
  if (value.length > MAX_OAUTH_NEXT || value.length === OAUTH_PREFIX.length) return null;
  const query = value.slice(OAUTH_PREFIX.length);
  if (!OAUTH_QUERY.test(query) || query.includes('//') || query.includes(':/') || query.includes('..')) return null;
  return value;
}

/** The value itself when it is a safe in-app path, otherwise null. Never throws. */
export function safeNext(raw: unknown): string | null {
  const value = first(raw);
  if (typeof value === 'string' && value.startsWith(OAUTH_PREFIX)) return safeOauthNext(value);
  if (typeof value !== 'string' || value.length > MAX_NEXT) return null;
  if (!value.startsWith(PREFIX) || value.length === PREFIX.length) return null;
  if (!SAFE_CHARS.test(value)) return null;
  if (value.includes('//')) return null;
  const [path = '', ...query] = value.split('?');
  if (query.length > 1) return null;
  if (query[0] !== undefined && query[0].includes('..')) return null;
  if (path.split('/').some((segment) => segment === '.' || segment === '..')) return null;
  return value;
}

/** The only plan the signup/login URLs may carry. Anything else is ignored. */
export type IntentPlan = 'pro';
export function safePlan(raw: unknown): IntentPlan | undefined {
  return raw === 'pro' ? 'pro' : undefined;
}

/** `/login`, with a safe `next` when given. */
export function loginHref(next: unknown): string {
  const safe = safeNext(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : '/login';
}

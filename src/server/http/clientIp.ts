import { rootLogger } from './logger';

export const UNKNOWN_IP = 'unknown';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4(value: string): string | undefined {
  const m = IPV4.exec(value);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return parts.join('.');
}

/** Expand an IPv6 literal to 8 numeric groups, or undefined when it is not valid. */
function ipv6Groups(value: string): number[] | undefined {
  let text = value;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4(tail);
    if (!v4) return undefined;
    const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (s: string) => (s === '' ? [] : s.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (all.length !== 8 || !all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return all.map((g) => parseInt(g, 16));
}

/**
 * Canonical rate-limit subject for an address:
 * - `%zone` suffix and `[ ]` brackets are dropped;
 * - IPv4-mapped IPv6 (`::ffff:1.2.3.4`) becomes the IPv4 address;
 * - IPv6 is masked to its /64 (one subscriber owns a whole /64, so a per-address key would be free to
 *   rotate): the first four groups, zero-padded and lowercased, as `2001:0db8:0000:0000::/64`;
 * - anything that is not a valid address is rejected (undefined).
 */
export function normaliseIp(raw: string | null | undefined): string | undefined {
  let v = raw?.trim().toLowerCase();
  if (!v || v.length > 64) return undefined;
  if (v.startsWith('[') && v.includes(']')) v = v.slice(1, v.indexOf(']'));
  const pct = v.indexOf('%');
  if (pct >= 0) v = v.slice(0, pct);
  if (!v.includes(':')) return ipv4(v);
  const g = ipv6Groups(v);
  if (!g) return undefined;
  // ::ffff:a.b.c.d (groups 0-4 zero, group 5 = ffff)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16).padStart(4, '0'))
    .join(':')}::/64`;
}

/** Proxy headers other than Vercel's are only believed on Vercel or when explicitly enabled. */
export const trustsProxyHeaders = (env: NodeJS.ProcessEnv = process.env) =>
  Boolean(env.VERCEL) || env.TRUST_PROXY_HEADERS === '1';

let warnedUnknown = false;
/** Test seam. */
export const resetClientIpWarning = () => {
  warnedUnknown = false;
};

/**
 * The client address used as a rate-limit key (normalised, see normaliseIp).
 *
 * Header trust order: `x-vercel-forwarded-for` (set by the Vercel edge; it overwrites any client value),
 * then `x-real-ip`, then the FIRST `x-forwarded-for` entry, then "unknown". The last two are client
 * controlled unless a trusted proxy rewrites them, so they are honoured only when `VERCEL` is set or
 * `TRUST_PROXY_HEADERS=1`. Anywhere else a spoofed header could mint unlimited buckets.
 *
 * "unknown" means we have no trustworthy address: callers SKIP per-IP budgets for it (otherwise every
 * visitor would share one bucket and a single flood would lock everyone out) and keep email-keyed ones.
 * Clients behind one carrier NAT share an address, which is why the limits are generous.
 */
export function clientIp(req: Request, env: NodeJS.ProcessEnv = process.env): string {
  const h = req.headers;
  let ip = normaliseIp(h.get('x-vercel-forwarded-for')?.split(',')[0]);
  if (!ip && trustsProxyHeaders(env)) {
    ip = normaliseIp(h.get('x-real-ip')) ?? normaliseIp(h.get('x-forwarded-for')?.split(',')[0]);
  }
  if (ip) return ip;
  if (env.NODE_ENV === 'production' && !warnedUnknown) {
    warnedUnknown = true;
    rootLogger.warn(
      { event: 'client_ip_unknown' },
      'no trustworthy client address in production; per-IP rate limits are skipped',
    );
  }
  return UNKNOWN_IP;
}

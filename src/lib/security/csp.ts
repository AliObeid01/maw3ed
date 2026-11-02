/**
 * Content-Security-Policy for pages (docs/ARCHITECTURE.md, Security headers). Pure: no env, no I/O, so it is
 * unit-tested and safe to import from the proxy. `src/proxy.ts` supplies the nonce, the DSN host and the mode.
 */

export type CspMode = 'enforce' | 'report-only' | 'off';

/** 128-bit random value, base64. Web Crypto only (works in the proxy runtime and in Node). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * The exact host events are posted to, from a Sentry DSN (`https://<key>@o123.ingest.de.sentry.io/<project>`).
 * Only a well-formed https DSN with a plain hostname counts; anything else gives `undefined` (no wildcard, no
 * guessing), so a typo in the variable can never widen the policy.
 */
export function sentryHostFromDsn(dsn: string | undefined): string | undefined {
  const value = dsn?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return undefined;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)) return undefined;
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** `CSP_MODE`: enforce (default), report-only, off. Anything else enforces. */
export function resolveCspMode(value: string | undefined): CspMode {
  const v = value?.trim().toLowerCase();
  return v === 'report-only' || v === 'off' ? v : 'enforce';
}

export function buildCsp({
  nonce,
  sentryHost,
  isProd,
}: {
  nonce: string;
  sentryHost: string | undefined;
  isProd: boolean;
}): string {
  const directives = [
    `default-src 'self'`,
    // Nonce + strict-dynamic: only scripts Next emits (carrying the nonce) and the chunks they load may run.
    // 'unsafe-eval' is development only (React refresh / HMR). Never 'unsafe-inline' for scripts.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? '' : " 'unsafe-eval'"}`,
    // Styles keep 'unsafe-inline': React renders style="" attributes (progress bars, safe-area, the QR sizing) and
    // Next injects <style> tags; a style nonce cannot cover attributes. Style injection is a far smaller risk than script.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'${sentryHost ? ` https://${sentryHost}` : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

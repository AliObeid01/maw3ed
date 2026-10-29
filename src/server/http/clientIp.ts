export const UNKNOWN_IP = 'unknown';
const MAX_IP_LENGTH = 64;

function clean(value: string | null | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  // Keep keys small and printable; anything else is not an address we can trust as a key.
  if (v.length > MAX_IP_LENGTH || !/^[0-9A-Fa-f:.\]\[%]+$/.test(v)) return undefined;
  return v.toLowerCase();
}

/**
 * The client address used as a rate-limit key.
 *
 * Header trust order: `x-vercel-forwarded-for` (set by the Vercel edge, a client cannot forge it), then
 * `x-real-ip`, then the FIRST entry of `x-forwarded-for`, then "unknown".
 *
 * Outside Vercel (local dev, a self-hosted reverse proxy that does not strip them) every one of these
 * headers is client-controlled and therefore spoofable: an attacker could rotate fake addresses to dodge
 * the per-IP limits. Production runs on Vercel, so the first header is authoritative; do not deploy this
 * behind a proxy that forwards client-supplied values without overwriting them.
 *
 * Clients behind one carrier NAT share an address, which is why the limits are generous.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    clean(h.get('x-vercel-forwarded-for')?.split(',')[0]) ??
    clean(h.get('x-real-ip')) ??
    clean(h.get('x-forwarded-for')?.split(',')[0]) ??
    UNKNOWN_IP
  );
}

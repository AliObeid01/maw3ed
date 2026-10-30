import type { TokenAction } from '@/server/domain/tokens';
import { verifyToken } from '@/server/domain/tokens';


export type LocaleScope = { kind: 'slug'; slug: string } | { kind: 'token'; token: string };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Actions a /l/ or /o/ page can carry. */
const LINK_ACTS: readonly TokenAction[] = ['view', 'confirm', 'cancel', 'pay'];
const OFFER_ACTS: readonly TokenAction[] = ['claim', 'leave'];

/** Only the three public page families that show the business: `/b/<slug>`, `/l/<token>`, `/o/<token>`. */
export function parseLocaleScope(pathname: string | null | undefined): LocaleScope | undefined {
  const m = /^\/(b|l|o)\/([^/]+)/.exec(pathname ?? '');
  if (!m) return undefined;
  let value: string;
  try {
    value = decodeURIComponent(m[2]!);
  } catch {
    return undefined;
  }
  if (m[1] === 'b') return SLUG.test(value) ? { kind: 'slug', slug: value } : undefined;
  return TOKEN.test(value) && value.length <= 512 ? { kind: 'token', token: value } : undefined;
}

export interface BusinessLocaleDeps {
  now: () => Date;
  secret: () => string | undefined;
  localeBySlug: (slug: string) => Promise<string | null>;
  localeByAppointment: (appointmentId: string) => Promise<string | null>;
  localeByOffer: (offerId: string) => Promise<string | null>;
}

/**
 * The language of the business behind a public page, or undefined (unknown page, unknown or expired token,
 * any failure): the caller then falls back to English and the client hint. A token is only used to find
 * the business; the page itself still enforces what the token allows.
 */
export async function resolveBusinessLocale(
  pathname: string | null | undefined,
  deps: BusinessLocaleDeps,
): Promise<string | undefined> {
  const scope = parseLocaleScope(pathname);
  if (!scope) return undefined;
  try {
    if (scope.kind === 'slug') return (await deps.localeBySlug(scope.slug)) ?? undefined;
    const secret = deps.secret();
    if (!secret || secret.length < 32) return undefined;
    const now = deps.now();
    for (const act of [...LINK_ACTS, ...OFFER_ACTS]) {
      const res = verifyToken(scope.token, secret, now, act);
      if (!res.ok) continue;
      const p = res.payload;
      const locale =
        p.o !== undefined
          ? await deps.localeByOffer(p.o)
          : await deps.localeByAppointment(p.a!);
      return locale ?? undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

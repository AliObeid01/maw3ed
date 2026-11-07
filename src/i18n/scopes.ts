import type { Messages } from './keys';

type Top = keyof Messages;
/** A top-level namespace (`'booking'`) or one branch of it (`'app.format'`). */
type Namespace = Top | `${Top}.${string}`;

/**
 * Which top-level message namespaces each route group ships to the browser (F11). Server Components read
 * messages on the server and need nothing here; only Client Components do. `email` and `dev` are never
 * listed: `email` is server-only, and `dev` is only reachable through the `dev` scope, which the (dev)
 * layout serves outside production.
 *
 * `tests/unit/intlScopes.test.ts` walks the import graph of every route group and fails when a client
 * component calls `useTranslations('x')` for a namespace its route group does not provide.
 */
export const INTL_SCOPES = {
  /** Root layout: pages outside any group (home, not-found) and the floor every nested scope repeats. */
  root: ['common', 'ui', 'notFound', 'public', 'directory'],
  /** `/b`, `/l`, `/o`, `/pay`, `/directory`, `/pricing`. */
  public: [
    'common',
    'ui',
    'public',
    'booking',
    'link',
    'offer',
    'reminderPromise',
    'waitlist',
    'deposit',
    'directory',
    'pricing',
    'home',
    'myBookings',
    'billing',
    // Shared money/duration formatting (useAppFormat); the rest of `app` is dashboard-only.
    'app.format',
  ],
  /** `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/invite`, `/verify-email`, `/activate`. */
  auth: ['common', 'ui', 'auth', 'recovery', 'verify', 'activation', 'app.format'],
  /** `/app/**`. */
  app: [
    'common',
    'ui',
    'app',
    'team',
    'verify',
    'directory',
    'billing',
    'booking',
    // Category and area labels in Settings (PR-1).
    'public.category',
    'public.area',
    // PasswordField on the change-password card.
    'auth.password',
  ],
} as const satisfies Record<string, readonly Namespace[]>;

export type IntlScope = keyof typeof INTL_SCOPES | 'dev';

/** Keeps only the listed namespaces, whole or one branch (`dev` scope: everything, development only). */
export function pickMessages<M extends Record<string, unknown>>(
  messages: M,
  namespaces: readonly string[] | 'all',
): Partial<M> {
  if (namespaces === 'all') return messages;
  const out: Record<string, unknown> = {};
  for (const ns of namespaces) {
    const path = ns.split('.');
    let from: unknown = messages;
    let to = out;
    for (const [i, key] of path.entries()) {
      if (typeof from !== 'object' || from === null || !(key in from)) break;
      const value = (from as Record<string, unknown>)[key];
      if (i === path.length - 1) to[key] = value;
      else {
        const next = (to[key] ??= {}) as Record<string, unknown>;
        from = value;
        to = next;
      }
    }
  }
  return out as Partial<M>;
}

export function namespacesFor(scope: IntlScope): readonly string[] | 'all' {
  return scope === 'dev' ? 'all' : INTL_SCOPES[scope];
}

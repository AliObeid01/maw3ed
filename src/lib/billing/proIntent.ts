import { isValidSlugFormat } from '@/lib/auth/slug';

/**
 * "This owner chose Pro when signing up" kept in this browser only (no database column, no migration). It drives the
 * persistent "Finish upgrading to Pro" card for that business until the plan is Pro. It is a reminder, not an
 * entitlement: the server decides what the plan allows. Holds only the business slug (public) and a version.
 */
export const PRO_INTENT_KEY = 'maw3ed:proIntent:v1';

export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const browser = (): IntentStorage | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function setProIntent(slug: string, storage: IntentStorage | undefined = browser()): void {
  if (!storage || !isValidSlugFormat(slug)) return;
  try {
    storage.setItem(PRO_INTENT_KEY, JSON.stringify({ v: 1, slug }));
  } catch {
    // blocked or full: the reminder is a nicety
  }
}

export function proIntentFor(slug: string, storage: IntentStorage | undefined = browser()): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(PRO_INTENT_KEY);
    if (!raw) return false;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return false;
    const { v, slug: stored } = value as Record<string, unknown>;
    return v === 1 && typeof stored === 'string' && isValidSlugFormat(stored) && stored === slug;
  } catch {
    return false;
  }
}

export function clearProIntent(storage: IntentStorage | undefined = browser()): void {
  try {
    storage?.removeItem(PRO_INTENT_KEY);
  } catch {
    // blocked
  }
}

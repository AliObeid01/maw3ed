import { z } from 'zod';
import { isValidSlugFormat } from '@/lib/auth/slug';

/**
 * "My bookings on this device": a small list of the bookings made in THIS browser, kept in localStorage.
 *
 * Privacy: only what the confirmation screen already shows about the appointment (business, service, staff,
 * time, reference) plus the signed `view` link token, which opens that one appointment and nothing else. The
 * client's name, phone and email are NEVER stored (the entry schema below has no such field and strips unknown
 * ones when reading). localStorage is shared by the whole origin, so the list is cross-business on the device
 * with no server-side join; anyone using this browser can read it.
 *
 * Robust by design: every storage access is in try/catch (blocked storage, private mode, quota), corrupt JSON is
 * dropped entry by entry, and nothing here ever throws. Pure and injectable (storage, clock, event target) so
 * the unit tests need no browser.
 */

export const STORAGE_KEY = 'maw3ed:myBookings:v1';
export const MAX_ENTRIES = 20;
/** An entry is dropped this long after the appointment started. */
export const KEEP_AFTER_START_MS = 90 * 24 * 60 * 60 * 1000;

export type EndedHow = 'cancelled' | 'closed';

export type SavedBooking = {
  /** The signed `act: 'view'` token (the last segment of the booking's manage link). A bearer secret: never log it or put it in a URL of this page. */
  token: string;
  slug: string;
  businessName: string;
  serviceName: string;
  staffName: string;
  /** ISO 8601 UTC instants. */
  startAt: string;
  endAt: string;
  /** IANA zone of the business: times are always shown in it. */
  timezone: string;
  /** Short booking code, a label and not a credential. */
  reference: string | null;
  savedAt: string;
  /** Set once the live link no longer applies: the booking was cancelled, or the link was refused/expired. Shown under "Previous visits". */
  ended?: EndedHow;
  /** True once the business marked the visit attended (asked of the outcome endpoint, which says nothing else). Cached for good. */
  completed?: true;
  /** When the outcome was last asked about (any answer or failure): drives the 6 hour re-check of a visit that is not completed. */
  outcomeCheckedAt?: string;
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type StorageEventLike = { key: string | null };
export interface EventTargetLike {
  addEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: 'storage', listener: (event: StorageEventLike) => void): void;
}

/** Instants outside these years are corrupt or hostile, never a real booking. */
const MIN_YEAR_MS = Date.UTC(2000, 0, 1);
const MAX_YEAR_MS = Date.UTC(2101, 0, 1);
const isoInstant = z
  .string()
  .max(40)
  .refine((v) => {
    const ms = Date.parse(v);
    return Number.isFinite(ms) && ms >= MIN_YEAR_MS && ms < MAX_YEAR_MS;
  });
const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * The signed link token is `base64url(body).base64url(signature)` (src/server/domain/tokens.ts, at most 512
 * characters): letters, digits, `-`, `_` and at most one dot. Anything else (a path, a scheme, spaces, HTML) can
 * never be a token and is never put in a request URL.
 */
export const TOKEN_MIN = 8;
export const TOKEN_MAX = 512;
const TOKEN_RE = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;
export const isValidToken = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= TOKEN_MIN &&
  value.length <= TOKEN_MAX &&
  TOKEN_RE.test(value);

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const entrySchema = z
  .object({
    token: z.string().refine(isValidToken),
    // The signup contract's slug rules (lowercase letters, digits, single hyphens, 3 to 40 characters).
    slug: z.string().refine(isValidSlugFormat),
    businessName: text(200),
    serviceName: text(200),
    staffName: text(200),
    startAt: isoInstant,
    endAt: isoInstant,
    timezone: text(64).refine(validZone),
    reference: z
      .string()
      .regex(/^[A-Za-z0-9]{1,32}$/)
      .nullable()
      .catch(null),
    savedAt: isoInstant,
    ended: z.enum(['cancelled', 'closed']).optional().catch(undefined),
    // Added after v1: optional, so v1 data reads unchanged. Anything but the literal true is dropped.
    completed: z.literal(true).optional().catch(undefined),
    outcomeCheckedAt: isoInstant.optional().catch(undefined),
  })
  .refine((e) => Date.parse(e.endAt) >= Date.parse(e.startAt));

const fileSchema = z.object({ v: z.literal(1), entries: z.array(z.unknown()) });

/** Same booking: same token, or the same business and reference. */
const sameBooking = (a: SavedBooking, b: SavedBooking) =>
  a.token === b.token || (a.reference !== null && a.reference === b.reference && a.slug === b.slug);

const newestFirst = (a: SavedBooking, b: SavedBooking) => Date.parse(b.savedAt) - Date.parse(a.savedAt);

/** Normalise a list: drop duplicates (newest save wins), expired entries and everything over the cap. */
function tidy(list: SavedBooking[], now: Date): SavedBooking[] {
  const out: SavedBooking[] = [];
  for (const item of [...list].sort(newestFirst)) {
    if (Date.parse(item.startAt) + KEEP_AFTER_START_MS < now.getTime()) continue;
    if (out.some((kept) => sameBooking(kept, item))) continue;
    out.push(item);
  }
  return out.slice(0, MAX_ENTRIES);
}

/** The stored text as a clean list. Never throws: corrupt JSON gives [], a bad entry is skipped. */
export function parseStored(raw: string | null, now: Date): SavedBooking[] {
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const file = fileSchema.safeParse(json);
  if (!file.success) return [];
  const good: SavedBooking[] = [];
  for (const candidate of file.data.entries) {
    const parsed = entrySchema.safeParse(candidate);
    if (!parsed.success) continue;
    const { ended, completed, outcomeCheckedAt, ...rest } = parsed.data;
    good.push({
      ...rest,
      ...(ended ? { ended } : {}),
      ...(completed ? { completed } : {}),
      ...(outcomeCheckedAt ? { outcomeCheckedAt } : {}),
    });
  }
  return tidy(good, now);
}

/** The token of a manage link such as `https://host/l/<token>`; undefined when there is none. */
export function tokenFromManageLink(manage: string): string | undefined {
  const path = (manage.split(/[?#]/)[0] ?? '').replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '');
  const last = path.split('/').filter(Boolean).pop();
  if (!last || last === 'l') return undefined;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

type BookingLike = {
  appointment: {
    reference: string | null;
    startAt: string;
    endAt: string;
    service: { name: string };
    staff: { displayName: string };
  };
  links: { manage: string };
};

/** The entry to save after a booking succeeds. Takes nothing about the client, so nothing about the client can leak. */
export function entryFromBooking(
  result: BookingLike,
  business: { slug: string; name: string; timezone: string },
  now: Date,
): SavedBooking | undefined {
  const token = tokenFromManageLink(result.links.manage);
  if (!token || !isValidToken(token) || !isValidSlugFormat(business.slug)) return undefined;
  return {
    token,
    slug: business.slug,
    businessName: business.name,
    serviceName: result.appointment.service.name,
    staffName: result.appointment.staff.displayName,
    startAt: result.appointment.startAt,
    endAt: result.appointment.endAt,
    timezone: business.timezone,
    reference: result.appointment.reference,
    savedAt: now.toISOString(),
  };
}

export type Availability = 'ok' | 'blocked';

export interface MyBookingsStore {
  /** The current list, newest save first. The same array object while nothing changed. */
  getAll(): SavedBooking[];
  count(): number;
  /** False when nothing could be saved (blocked or full); never throws. */
  save(entry: SavedBooking): boolean;
  markEnded(token: string, how: EndedHow): void;
  /** Record what the outcome endpoint said. "false" also stands for a failed check: only the time is kept. "completed" is never erased. */
  markOutcome(token: string, completed: boolean): void;
  clear(): void;
  availability(): Availability;
  /** Same-tab writes and other tabs (the `storage` event). Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

const EMPTY: SavedBooking[] = [];
const PROBE_KEY = `${STORAGE_KEY}:probe`;

export function createMyBookingsStore(deps: {
  storage: () => StorageLike | undefined;
  now: () => Date;
  target?: EventTargetLike;
}): MyBookingsStore {
  const listeners = new Set<() => void>();
  let probed: Availability | undefined;
  let cache: { raw: string | null; list: SavedBooking[]; validUntil: number } | undefined;

  const storage = (): StorageLike | undefined => {
    try {
      return deps.storage();
    } catch {
      return undefined;
    }
  };
  const readRaw = (s: StorageLike | undefined): string | null => {
    try {
      return s?.getItem(STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  };

  function getAll(): SavedBooking[] {
    const raw = readRaw(storage());
    const at = deps.now();
    if (cache && cache.raw === raw && at.getTime() < cache.validUntil) return cache.list;
    const parsed = parseStored(raw, at);
    // The list stays valid until the first entry would expire.
    const validUntil = Math.min(
      Infinity,
      ...parsed.map((e) => Date.parse(e.startAt) + KEEP_AFTER_START_MS),
    );
    cache = { raw, list: parsed.length === 0 ? EMPTY : parsed, validUntil };
    return cache.list;
  }

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };

  /** Write the list; on a quota error keep trying with fewer (older ones go first). */
  function write(list: SavedBooking[]): boolean {
    const s = storage();
    if (!s) return false;
    let keep = [...list].sort(newestFirst);
    while (true) {
      try {
        if (keep.length === 0) s.removeItem(STORAGE_KEY);
        else s.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries: keep }));
        notify();
        return true;
      } catch {
        if (keep.length <= 1) return false;
        keep = keep.slice(0, Math.floor(keep.length / 2));
      }
    }
  }

  const onStorage = (event: StorageEventLike) => {
    if (event.key === null || event.key === STORAGE_KEY) notify();
  };

  return {
    getAll,
    count: () => getAll().length,
    save(entry) {
      const others = getAll().filter((e) => !sameBooking(e, entry));
      return write(tidy([entry, ...others], deps.now()));
    },
    markEnded(token, how) {
      const all = getAll();
      if (!all.some((e) => e.token === token && e.ended !== how)) return;
      write(all.map((e) => (e.token === token ? { ...e, ended: how } : e)));
    },
    markOutcome(token, completed) {
      const all = getAll();
      const checkedAt = deps.now().toISOString();
      const target = all.find((e) => e.token === token);
      if (!target || (target.completed && completed)) return;
      write(
        all.map((e) =>
          e.token !== token
            ? e
            : e.completed
              ? e
              : completed
                ? { ...e, completed: true as const, outcomeCheckedAt: checkedAt }
                : { ...e, outcomeCheckedAt: checkedAt },
        ),
      );
    },
    clear() {
      const s = storage();
      try {
        s?.removeItem(STORAGE_KEY);
      } catch {
        // blocked: nothing was saved anyway
      }
      cache = undefined;
      notify();
    },
    availability() {
      const s = storage();
      if (!s) return 'blocked'; // not cached: on the server `window` appears later
      if (probed) return probed;
      try {
        s.setItem(PROBE_KEY, '1');
        s.removeItem(PROBE_KEY);
        probed = 'ok';
      } catch {
        probed = 'blocked';
      }
      return probed;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) deps.target?.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) deps.target?.removeEventListener('storage', onStorage);
      };
    },
  };
}

const browserStorage = (): StorageLike | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined; // accessing it throws when cookies/storage are blocked
  }
};

/** The app's store. SSR-safe: with no `window` it reads as empty and writes nothing. */
export const myBookings: MyBookingsStore = createMyBookingsStore({
  storage: browserStorage,
  now: () => new Date(),
  target: typeof window === 'undefined' ? undefined : window,
});

export const EMPTY_BOOKINGS: SavedBooking[] = EMPTY;

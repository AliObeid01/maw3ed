import type { ClientHit } from '@/lib/api/dashboard';
import { isE164 } from '@/lib/dashboard/phone';

export const LOOKUP_DELAY_MS = 350;
/** Fewer digits than this match too many people to be useful. */
export const LOOKUP_MIN_DIGITS = 6;

export type LookupState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; client: ClientHit }
  | { status: 'none' };

/** Digits only, Latin: what the clients search takes. */
export const lookupDigits = (phone: string) => phone.replace(/\D/g, '');

/** The hit whose number really matches the typed phone (a search by fragment may return neighbours). */
export function pickClient(hits: ClientHit[], phone: string): ClientHit | undefined {
  const typed = lookupDigits(phone);
  if (!typed) return undefined;
  // An anonymised client's tombstone phone must never match a number someone types.
  return hits.find((h) => isE164(h.phone) && lookupDigits(h.phone) === typed);
}

/**
 * Debounced client lookup by phone. Only the latest input counts: a slow response for an older number is
 * dropped, and typing a shorter number cancels the search. Errors resolve to "none" (the form still works).
 */
export function createLookup(options: {
  search: (digits: string, signal: AbortSignal) => Promise<ClientHit[]>;
  onState: (state: LookupState) => void;
  delayMs?: number;
}) {
  const delay = options.delayMs ?? LOOKUP_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let current = 0;

  const cancel = () => {
    clearTimeout(timer);
    controller?.abort();
    controller = undefined;
  };

  return {
    /** `phone` is the full assembled number (E.164-like text). */
    input(phone: string) {
      cancel();
      const id = ++current;
      const digits = lookupDigits(phone);
      if (digits.length < LOOKUP_MIN_DIGITS) {
        options.onState({ status: 'idle' });
        return;
      }
      options.onState({ status: 'searching' });
      timer = setTimeout(() => {
        const mine = new AbortController();
        controller = mine;
        options
          .search(digits, mine.signal)
          .then((hits) => {
            if (id !== current) return;
            const client = pickClient(hits, phone);
            options.onState(client ? { status: 'found', client } : { status: 'none' });
          })
          .catch(() => {
            if (id !== current) return;
            options.onState({ status: 'none' });
          });
      }, delay);
    },
    dispose() {
      current++;
      cancel();
    },
  };
}

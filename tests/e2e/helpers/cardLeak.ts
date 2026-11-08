import { expect, type Page } from '@playwright/test';

/**
 * The card-digits guard, end to end (PR-12; replaces the unit test that only pinned two function signatures).
 * Records EVERYTHING that could carry what was typed in the TEST card form while a spec runs: every request (URL,
 * headers, body), every console message, every Web Storage write and the cookies. `assertNoCardDigits` then fails
 * when any of it contains a run of 8 or more consecutive digits of a card number that was typed.
 *
 * Call `watchCardLeaks(page)` before the first navigation and `assertNoCardDigits(...)` at the end of the spec.
 */
export type CardLeakWatch = {
  assertNoCardDigits: (typedCards: string[]) => Promise<void>;
  /** Number of requests recorded (so a spec can prove the watcher saw traffic). */
  requestCount: () => number;
};

const RUN = 8;

function windows(card: string): string[] {
  const digits = card.replaceAll(/\D/g, '');
  const out: string[] = [];
  for (let i = 0; i + RUN <= digits.length; i += 1) out.push(digits.slice(i, i + RUN));
  return out;
}

export async function watchCardLeaks(page: Page): Promise<CardLeakWatch> {
  const haystack: string[] = [];
  let requests = 0;
  page.on('request', (req) => {
    requests += 1;
    haystack.push(req.url(), JSON.stringify(req.headers()), req.postData() ?? '');
  });
  page.on('console', (m) => haystack.push(m.text()));
  page.on('websocket', (ws) => haystack.push(ws.url()));
  await page.addInitScript(() => {
    const w = window as unknown as { __storageWrites: string[] };
    w.__storageWrites = [];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      w.__storageWrites.push(`${key}=${value}`);
      return original.call(this, key, value);
    };
    // sendBeacon and window.name are other ways out of the page.
    const beacon = navigator.sendBeacon?.bind(navigator);
    if (beacon)
      navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
        w.__storageWrites.push(`beacon ${String(url)} ${typeof data === 'string' ? data : ''}`);
        return beacon(url, data);
      };
  });

  return {
    requestCount: () => requests,
    async assertNoCardDigits(typedCards) {
      const inPage = await page.evaluate(() => {
        const w = window as unknown as { __storageWrites?: string[] };
        return [
          ...(w.__storageWrites ?? []),
          JSON.stringify({ ...localStorage }),
          JSON.stringify({ ...sessionStorage }),
          window.name,
          document.cookie,
          location.href,
        ];
      });
      const cookies = JSON.stringify(await page.context().cookies());
      const all = [...haystack, ...inPage, cookies].join('\n').replaceAll(/[\s-]/g, '');
      expect(requests, 'the watcher saw no traffic: it is not attached').toBeGreaterThan(0);
      for (const card of typedCards)
        for (const w of windows(card)) expect(all, `a run of card digits (${w.slice(0, 2)}...) leaked`).not.toContain(w);
    },
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkoutPro } from '@/lib/api/billing';
import { postPay } from '@/lib/api/pay';
import { TEST_CARD_DECLINED, TEST_CARD_SUCCESS } from '@/lib/billing/testCard';

/**
 * The card-digits-never-sent guard at the client boundary: the only functions the card form's callers use
 * (`checkoutPro`, `postPay`) take a scenario and nothing else. Whatever is typed in the form cannot reach them, and
 * the serialized request (URL, headers, body) must contain no run of card digits.
 */
afterEach(() => vi.unstubAllGlobals());

function capture() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { code: 'X', message: 'x', fields: {} } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const digitsRun = /\d{9,}/;
const everything = (c: { url: string; init: RequestInit }) =>
  `${c.url} ${JSON.stringify(c.init.headers ?? {})} ${String(c.init.body ?? '')}`.replaceAll(/\s/g, '');

describe('card digits never leave the browser', () => {
  it('checkoutPro sends only plan and scenario', async () => {
    const calls = capture();
    for (const scenario of ['success', 'declined'] as const)
      await checkoutPro('key-abcdefgh-ijkl', scenario).catch(() => undefined);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const body = JSON.parse(String(c.init.body));
      expect(Object.keys(body).sort()).toEqual(['plan', 'scenario']);
      expect(everything(c)).not.toMatch(digitsRun);
      for (const card of [TEST_CARD_SUCCESS, TEST_CARD_DECLINED])
        expect(everything(c)).not.toContain(card.replaceAll(' ', ''));
    }
  });

  it('postPay sends only the scenario', async () => {
    const calls = capture();
    await postPay('tok.sig-123456', 'declined').catch(() => undefined);
    await postPay('tok.sig-123456').catch(() => undefined);
    for (const c of calls) {
      const body = JSON.parse(String(c.init.body));
      expect(Object.keys(body)).toEqual(['scenario']);
      expect(['success', 'declined']).toContain(body.scenario);
      expect(everything(c)).not.toMatch(digitsRun);
    }
  });
});

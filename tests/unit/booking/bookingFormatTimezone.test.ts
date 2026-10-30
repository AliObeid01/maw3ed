import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { useBookingFormat } from '@/components/booking/useBookingFormat';
import en from '../../../messages/en.json';

// The free-cancellation line formats instants with f.day / f.time: they must use the BUSINESS timezone,
// never the visitor's device zone (a visitor may be abroad).
function Probe({ iso, tz }: { iso: string; tz: string }) {
  const f = useBookingFormat(tz);
  return createElement('span', null, `${f.day(iso)}|${f.time(iso)}`);
}
const render = (iso: string, tz: string) =>
  renderToString(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages: en } as never,
      createElement(Probe, { iso, tz }),
    ),
  ).replace(/<[^>]+>/g, '');

describe('useBookingFormat day/time use the business timezone', () => {
  const original = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/New_York';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('formats in Asia/Beirut while the process runs in New York', () => {
    expect(new Date('2026-11-04T07:00:00Z').getTimezoneOffset()).toBe(300);
    // 07:00 UTC = 09:00 in Beirut (UTC+2) but 02:00 in New York.
    expect(render('2026-11-04T07:00:00Z', 'Asia/Beirut')).toBe('Wed, Nov 4|9:00');
    // 23:30 UTC on 4 Nov is already 5 Nov in Beirut.
    expect(render('2026-11-04T23:30:00Z', 'Asia/Beirut')).toBe('Thu, Nov 5|1:30');
  });
});

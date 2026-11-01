import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useFormatter, useTimeZone } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n/config';
import { IntlBoundary } from '@/components/i18n/IntlBoundary';

// 2026-11-01 21:30 UTC = 23:30 in Beirut (UTC+2), 10:30 on 2 Nov in Kiritimati (UTC+14) and Auckland (UTC+13),
// 13:30 on 1 Nov in Los Angeles (PST).
const INSTANT = new Date('2026-11-01T21:30:00Z');

function Clock() {
  const format = useFormatter();
  const zone = useTimeZone();
  const time = format.dateTime(INSTANT, { hour: 'numeric', minute: '2-digit', hour12: false });
  const day = format.dateTime(INSTANT, { day: 'numeric', month: 'short' });
  return createElement('p', null, `${zone}|${time}|${day}`);
}

const render = (timeZone: string, locale: Locale = 'en') =>
  renderToStaticMarkup(
    createElement(
      IntlBoundary,
      { locale, messages: {}, timeZone } as ComponentProps<typeof IntlBoundary>,
      createElement(Clock),
    ),
  );

describe('provider time zone (F5)', () => {
  const original = process.env.TZ;
  beforeEach(() => {
    // The visitor's device is on the other side of the date line from the business.
    process.env.TZ = 'Pacific/Kiritimati';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('formats in the business zone, not the visitor device zone', () => {
    expect(new Date(INSTANT).getDate()).toBe(2); // sanity: the device really is on 2 Nov
    expect(render('Asia/Beirut')).toBe('<p>Asia/Beirut|23:30|Nov 1</p>');
  });

  it('two visitors in different zones see the same business-local time', () => {
    const fromKiritimati = render('Asia/Beirut');
    process.env.TZ = 'America/Los_Angeles';
    const fromLosAngeles = render('Asia/Beirut');
    expect(fromLosAngeles).toBe(fromKiritimati);
    expect(fromLosAngeles).toContain('23:30');
  });

  it('a different business zone gives that zone, including the date change', () => {
    expect(render('Pacific/Auckland')).toBe('<p>Pacific/Auckland|10:30|Nov 2</p>');
  });
});

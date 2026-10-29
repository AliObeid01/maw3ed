import { DateTime } from 'luxon';
import { getEmailMessages, isRtl } from './messages';

export type EmailKind = 'BOOKING' | 'H24' | 'H2';

export interface EmailContext {
  kind: EmailKind;
  /** Business.locale: 'en' | 'ar'. */
  locale: string;
  /** Business.timezone (IANA). */
  timezone: string;
  businessName: string;
  clientName: string;
  serviceName: string;
  staffName: string;
  startAt: Date;
  confirmUrl: string;
  cancelUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** `{name}` placeholders; unknown placeholders are left as written. */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Local date and time in the business timezone; Latin digits in every locale. */
export function formatLocal(startAt: Date, timezone: string, locale: string) {
  const dt = DateTime.fromJSDate(startAt, { zone: timezone }).reconfigure({
    locale: isRtl(locale) ? 'ar' : 'en',
    numberingSystem: 'latn',
  });
  const date = dt.toFormat('cccc d LLLL yyyy');
  const time = dt.toFormat('HH:mm');
  return { date, time, when: `${date}, ${time}` };
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

const KIND_KEY = { BOOKING: 'booking', H24: 'h24', H2: 'h2' } as const;

function vars(c: EmailContext): Record<string, string> {
  const f = formatLocal(c.startAt, c.timezone, c.locale);
  return {
    name: c.clientName,
    business: c.businessName,
    service: c.serviceName,
    staff: c.staffName,
    date: f.date,
    time: f.time,
    when: f.when,
    confirmUrl: c.confirmUrl,
    cancelUrl: c.cancelUrl,
  };
}

/** Subject, plain text and simple HTML for a booking confirmation or a 24 h / 2 h reminder. Pure. */
export function renderReminderEmail(c: EmailContext): RenderedEmail {
  const m = getEmailMessages(c.locale);
  const copy = m[KIND_KEY[c.kind]];
  const v = vars(c);
  const subject = oneLine(interpolate(copy.subject, v));
  const intro = interpolate(copy.intro, v);
  const greeting = interpolate(m.greeting, v);
  const footer = interpolate(m.footer, v);
  const f = formatLocal(c.startAt, c.timezone, c.locale);
  const details: Array<[string, string]> = [
    [m.labels.service, c.serviceName],
    [m.labels.staff, c.staffName],
    [m.labels.when, f.when],
    [m.labels.business, c.businessName],
  ];
  const calendarNote = c.kind === 'BOOKING' ? m.calendar : undefined;

  const text = [
    greeting,
    '',
    copy.heading,
    intro,
    '',
    ...details.map(([k, val]) => `${k}: ${val}`),
    '',
    `${m.actions.confirm}: ${c.confirmUrl}`,
    `${m.actions.cancel}: ${c.cancelUrl}`,
    '',
    m.actions.linkNote,
    ...(calendarNote ? [calendarNote] : []),
    '',
    footer,
    '',
  ].join('\n');

  const dir = isRtl(c.locale) ? 'rtl' : 'ltr';
  const lang = isRtl(c.locale) ? 'ar' : 'en';
  const e = escapeHtml;
  const button = (label: string, url: string, bg: string) =>
    `<a href="${e(url)}" style="display:inline-block;padding:12px 20px;margin:4px 0;border-radius:8px;background:${bg};color:#ffffff;text-decoration:none;font-weight:600">${e(label)}</a>`;
  const html = [
    '<!doctype html>',
    `<html lang="${lang}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body dir="${dir}" style="margin:0;padding:16px;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;color:#1b1b1b">`,
    `<div dir="${dir}" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;text-align:start">`,
    `<p style="margin:0 0 12px">${e(greeting)}</p>`,
    `<h1 style="margin:0 0 8px;font-size:20px">${e(copy.heading)}</h1>`,
    `<p style="margin:0 0 16px">${e(intro)}</p>`,
    '<table role="presentation" style="border-collapse:collapse;margin:0 0 20px">',
    ...details.map(
      ([k, val]) =>
        `<tr><td style="padding:4px 12px;color:#5a5a5a">${e(k)}</td><td style="padding:4px 12px;font-weight:600">${e(val)}</td></tr>`,
    ),
    '</table>',
    `<p style="margin:0 0 8px">${button(m.actions.confirm, c.confirmUrl, '#0E7C66')}</p>`,
    `<p style="margin:0 0 16px">${button(m.actions.cancel, c.cancelUrl, '#8a3b2e')}</p>`,
    `<p style="margin:0 0 8px;color:#5a5a5a;font-size:13px">${e(m.actions.linkNote)}</p>`,
    ...(calendarNote
      ? [`<p style="margin:0 0 8px;color:#5a5a5a;font-size:13px">${e(calendarNote)}</p>`]
      : []),
    `<p style="margin:16px 0 0;color:#8a8a8a;font-size:12px">${e(footer)}</p>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');

  return { subject, text, html };
}

/** The prefilled WhatsApp text for the receptionist (H24 or H2). Plain text; the URL builder encodes it. */
export function renderWhatsappMessage(c: EmailContext & { kind: 'H24' | 'H2' }): string {
  const m = getEmailMessages(c.locale);
  return interpolate(m.whatsapp[KIND_KEY[c.kind]], vars(c));
}

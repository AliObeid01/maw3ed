import { DateTime } from 'luxon';
import { formatClock } from '@/lib/time/clock';
import { emailDetails, emailStyles, renderEmailLayout } from './emailLayout';
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

/**
 * The email variant: `clientName: null` greets generically. The record name must only reach the holder of
 * the record email (see `greetingName` in domain/contactEmail.ts).
 */
export type ReminderEmailContext = Omit<EmailContext, 'clientName'> & { clientName: string | null };

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
  const time = formatClock(startAt, timezone);
  return { date, time, when: `${date}, ${time}` };
}

const CONTROL_CHARS = new RegExp(String.raw`[\u0000-\u001f\u007f-\u009f  ]`, 'g');

/**
 * One-line, control-free text for every dynamic value (names, service, business): CR/LF and other control
 * characters become spaces and runs of whitespace collapse, so a value can never add a line, a header or a
 * fake link line to the plain-text body, the subject or the WhatsApp message.
 */
export function oneLine(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

const KIND_KEY = { BOOKING: 'booking', H24: 'h24', H2: 'h2' } as const;

function vars(c: ReminderEmailContext): Record<string, string> {
  const f = formatLocal(c.startAt, c.timezone, c.locale);
  return {
    name: oneLine(c.clientName ?? ''),
    business: oneLine(c.businessName),
    service: oneLine(c.serviceName),
    staff: oneLine(c.staffName),
    date: f.date,
    time: f.time,
    when: f.when,
    confirmUrl: c.confirmUrl,
    cancelUrl: c.cancelUrl,
  };
}

/** HTML-escape a template; dynamic values are escaped and, for right-to-left mail, isolated in <bdi>. */
export function interpolateHtml(template: string, v: Record<string, string>, rtl: boolean): string {
  return template
    .split(/(\{\w+\})/)
    .map((part) => {
      const key = /^\{(\w+)\}$/.exec(part)?.[1];
      if (key === undefined || v[key] === undefined) return escapeHtml(part);
      const escaped = escapeHtml(v[key]);
      return rtl ? `<bdi>${escaped}</bdi>` : escaped;
    })
    .join('');
}

/** Subject, plain text and simple HTML for a booking confirmation or a 24 h / 2 h reminder. Pure. */
export function renderReminderEmail(c: ReminderEmailContext): RenderedEmail {
  const m = getEmailMessages(c.locale);
  const copy = m[KIND_KEY[c.kind]];
  const v = vars(c);
  const subject = oneLine(interpolate(copy.subject, v));
  const intro = interpolate(copy.intro, v);
  const greetingTemplate = c.clientName === null ? m.greetingGeneric : m.greeting;
  const greeting = interpolate(greetingTemplate, v);
  const footer = interpolate(m.footer, v);
  const rtl = isRtl(c.locale);
  const f = formatLocal(c.startAt, c.timezone, c.locale);
  const details: Array<[string, string]> = [
    [m.labels.service, v.service!],
    [m.labels.staff, v.staff!],
    [m.labels.when, f.when],
    [m.labels.business, v.business!],
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

  const e = escapeHtml;
  const html = renderEmailLayout({
    locale: c.locale,
    preheader: intro,
    title: copy.heading,
    bodyHtml: [
      `<p style="${emailStyles.p}">${interpolateHtml(greetingTemplate, v, rtl)}</p>`,
      `<p style="${emailStyles.p}">${interpolateHtml(copy.intro, v, rtl)}</p>`,
      emailDetails(details, rtl),
    ].join('\n'),
    cta: { label: m.actions.confirm, url: c.confirmUrl },
    secondary: [{ label: m.actions.cancel, url: c.cancelUrl }],
    notesHtml: [e(m.actions.linkNote), ...(calendarNote ? [e(calendarNote)] : [])],
    footerHtml: interpolateHtml(m.footer, v, rtl),
  });

  return { subject, text, html };
}

/** The prefilled WhatsApp text for the receptionist (H24 or H2). Plain text; the URL builder encodes it. */
export function renderWhatsappMessage(c: EmailContext & { kind: 'H24' | 'H2' }): string {
  const m = getEmailMessages(c.locale);
  return interpolate(m.whatsapp[KIND_KEY[c.kind]], vars(c));
}

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
export type ReminderEmailContext = Omit<EmailContext, 'clientName'> & {
  clientName: string | null;
  /**
   * BOOKING email only (F68; see `bookingEmailPlan` in domain/bookingPlan.ts): `'cancel'` when an H24 reminder
   * will follow, so the email carries the Cancel link alone. Default `'both'`. Ignored for H24 and H2 (which
   * carry both links unless `confirmed`).
   */
  links?: 'both' | 'cancel' | undefined;
  /** BOOKING email only: add the "we will email you a reminder" sentence. Only when one is really planned. */
  reminderPromise?: boolean | undefined;
  /**
   * H24 / H2 only: the client already confirmed (see confirmedBeforeReminder). The email then carries the Cancel
   * link alone and the line "You have confirmed this appointment."; subject and heading are unchanged.
   */
  confirmed?: boolean | undefined;
  /** BOOKING email only: the booking reference line. Stored value, so a retry renders the same bytes. */
  reference?: string | null | undefined;
};

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

function vars(c: Omit<ReminderEmailContext, 'kind'>): Record<string, string> {
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
  const isBooking = c.kind === 'BOOKING';
  if (isBooking && c.reference) details.push([m.labels.reference, oneLine(c.reference)]);
  const calendarNote = isBooking ? m.calendar : undefined;
  // F68: only the immediate booking email can be cancel-only (an H24 reminder with both links follows).
  const confirmedVariant = !isBooking && c.confirmed === true;
  const cancelOnly = (isBooking && c.links === 'cancel') || confirmedVariant;
  const confirmedNote = confirmedVariant ? m.confirmedNote : undefined;
  const promise = isBooking && c.reminderPromise === true ? m.booking.reminderPromise : undefined;
  // Every email here carries at least the Cancel link, so the "links stop working" note always applies.
  const linkLines = [
    ...(cancelOnly ? [] : [`${m.actions.confirm}: ${c.confirmUrl}`]),
    `${m.actions.cancel}: ${c.cancelUrl}`,
  ];

  const text = [
    greeting,
    '',
    copy.heading,
    intro,
    '',
    ...details.map(([k, val]) => `${k}: ${val}`),
    '',
    ...(promise ? [promise, ''] : []),
    ...(confirmedNote ? [confirmedNote, ''] : []),
    ...linkLines,
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
      ...(promise ? [`<p style="${emailStyles.p}">${e(promise)}</p>`] : []),
      ...(confirmedNote ? [`<p style="${emailStyles.p}">${e(confirmedNote)}</p>`] : []),
    ].join('\n'),
    // Cancel-only: Cancel is the single (primary) button; the brand-blue button on white passes AA.
    cta: cancelOnly
      ? { label: m.actions.cancel, url: c.cancelUrl }
      : { label: m.actions.confirm, url: c.confirmUrl },
    secondary: cancelOnly ? [] : [{ label: m.actions.cancel, url: c.cancelUrl }],
    notesHtml: [e(m.actions.linkNote), ...(calendarNote ? [e(calendarNote)] : [])],
    footerHtml: interpolateHtml(m.footer, v, rtl),
  });

  return { subject, text, html };
}

const WHATSAPP_KEY = { H24: 'h24', H2: 'h2', LATE: 'late' } as const;

/**
 * The prefilled WhatsApp text for the receptionist: the H24 / H2 reminder, or (F68) the confirmation-style
 * text of a last-minute booking (LATE, no "reminder" wording). Plain text; the URL builder encodes it.
 */
export function renderWhatsappMessage(
  c: Omit<EmailContext, 'kind'> & {
    kind: 'H24' | 'H2' | 'LATE';
    /** H24 / H2: the client already confirmed: no Confirm line, the confirmed note instead. LATE ignores it. */
    confirmed?: boolean | undefined;
  },
): string {
  const m = getEmailMessages(c.locale);
  if (c.confirmed === true && c.kind !== 'LATE') {
    const key = c.kind === 'H24' ? 'h24Confirmed' : 'h2Confirmed';
    return interpolate(m.whatsapp[key], { ...vars(c), note: m.confirmedNote });
  }
  return interpolate(m.whatsapp[WHATSAPP_KEY[c.kind]], vars(c));
}

/**
 * The prefilled WhatsApp text for the owner to send a staff member their one-time activation link. It carries the
 * link and the login phone number and nothing else: never a password, never client or appointment data.
 */
export function renderStaffLoginMessage(c: {
  locale: string;
  businessName: string;
  staffName: string;
  url: string;
  phone: string;
}): string {
  const m = getEmailMessages(c.locale);
  return interpolate(m.whatsapp.staffLogin, {
    name: c.staffName,
    business: c.businessName,
    url: c.url,
    phone: c.phone,
  });
}

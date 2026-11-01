import {
  escapeHtml,
  formatLocal,
  interpolate,
  interpolateHtml,
  oneLine,
  type RenderedEmail,
} from './emailRender';
import { emailDetails, emailStyles, renderEmailLayout } from './emailLayout';
import { getEmailMessages, isRtl } from './messages';

export interface OfferEmailContext {
  locale: string;
  timezone: string;
  businessName: string;
  clientName: string;
  serviceName: string;
  staffName: string;
  startAt: Date;
  /** The offer's own expiry (never "now"): the same offer always renders the same bytes. */
  expiresAt: Date;
  claimUrl: string;
  /** Signed one-click "remove me from the waitlist" page. */
  leaveUrl: string;
}

/** Waitlist offer: subject, plain text and simple HTML. Pure and deterministic per offer. */
export function renderOfferEmail(c: OfferEmailContext): RenderedEmail {
  const m = getEmailMessages(c.locale);
  const copy = m.offer;
  const f = formatLocal(c.startAt, c.timezone, c.locale);
  const until = formatLocal(c.expiresAt, c.timezone, c.locale).time;
  const v: Record<string, string> = {
    name: oneLine(c.clientName),
    business: oneLine(c.businessName),
    service: oneLine(c.serviceName),
    staff: oneLine(c.staffName),
    date: f.date,
    time: f.time,
    when: f.when,
    until,
  };
  const rtl = isRtl(c.locale);
  const subject = oneLine(interpolate(copy.subject, v));
  const e = escapeHtml;
  const details: Array<[string, string]> = [
    [m.labels.service, v.service!],
    [m.labels.staff, v.staff!],
    [m.labels.when, f.when],
    [m.labels.business, v.business!],
  ];
  const text = [
    interpolate(m.greeting, v),
    '',
    copy.heading,
    interpolate(copy.intro, v),
    '',
    ...details.map(([k, val]) => `${k}: ${val}`),
    '',
    interpolate(copy.expires, v),
    `${copy.claim}: ${c.claimUrl}`,
    '',
    copy.linkNote,
    `${copy.leave}: ${c.leaveUrl}`,
    '',
    interpolate(m.footer, v),
    '',
  ].join('\n');
  const html = renderEmailLayout({
    locale: c.locale,
    preheader: interpolate(copy.intro, v),
    title: copy.heading,
    bodyHtml: [
      `<p style="${emailStyles.p}">${interpolateHtml(m.greeting, v, rtl)}</p>`,
      `<p style="${emailStyles.p}">${interpolateHtml(copy.intro, v, rtl)}</p>`,
      emailDetails(details, rtl),
      `<p style="${emailStyles.p}"><strong>${interpolateHtml(copy.expires, v, rtl)}</strong></p>`,
    ].join('\n'),
    cta: { label: copy.claim, url: c.claimUrl },
    secondary: [{ label: copy.leave, url: c.leaveUrl }],
    notesHtml: [e(copy.linkNote)],
    footerHtml: interpolateHtml(m.footer, v, rtl),
  });
  return { subject, text, html };
}

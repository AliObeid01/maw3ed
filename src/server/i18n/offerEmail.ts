import {
  escapeHtml,
  formatLocal,
  interpolate,
  interpolateHtml,
  oneLine,
  type RenderedEmail,
} from './emailRender';
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
  const bdi = (value: string) => (rtl ? `<bdi>${e(value)}</bdi>` : e(value));
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
    '',
    interpolate(m.footer, v),
    '',
  ].join('\n');
  const dir = rtl ? 'rtl' : 'ltr';
  const html = [
    '<!doctype html>',
    `<html lang="${rtl ? 'ar' : 'en'}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body dir="${dir}" style="margin:0;padding:16px;background:#f6f5f1;font-family:Arial,Helvetica,sans-serif;color:#1b1b1b">`,
    `<div dir="${dir}" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;text-align:start">`,
    `<p style="margin:0 0 12px">${interpolateHtml(m.greeting, v, rtl)}</p>`,
    `<h1 style="margin:0 0 8px;font-size:20px">${e(copy.heading)}</h1>`,
    `<p style="margin:0 0 16px">${interpolateHtml(copy.intro, v, rtl)}</p>`,
    '<table role="presentation" style="border-collapse:collapse;margin:0 0 20px">',
    ...details.map(
      ([k, val]) =>
        `<tr><td style="padding:4px 12px;color:#5a5a5a">${e(k)}</td><td style="padding:4px 12px;font-weight:600">${bdi(val)}</td></tr>`,
    ),
    '</table>',
    `<p style="margin:0 0 16px">${interpolateHtml(copy.expires, v, rtl)}</p>`,
    `<p style="margin:0 0 16px"><a href="${e(c.claimUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#0E7C66;color:#ffffff;text-decoration:none;font-weight:600">${e(copy.claim)}</a></p>`,
    `<p style="margin:0 0 8px;color:#5a5a5a;font-size:13px">${e(copy.linkNote)}</p>`,
    `<p style="margin:16px 0 0;color:#8a8a8a;font-size:12px">${interpolateHtml(m.footer, v, rtl)}</p>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
  return { subject, text, html };
}

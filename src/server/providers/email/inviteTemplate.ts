import { escapeHtml, formatLocal, interpolate, oneLine } from '@/server/i18n/emailRender';
import { emailFontStack, getEmailMessages, isRtl } from '@/server/i18n/messages';

export interface InviteEmailOptions {
  businessName: string;
  acceptUrl: string;
  expiresAt: Date;
  /** Business.locale; unknown values use English. */
  locale?: string;
  /** Business.timezone (IANA). */
  timezone?: string;
}

/** Staff invite email in the business language. Pure; the shape (subject, text, html) is the provider contract. */
export function inviteEmail(opts: InviteEmailOptions) {
  const locale = opts.locale ?? 'en';
  const m = getEmailMessages(locale).invite;
  const rtl = isRtl(locale);
  const dir = rtl ? 'rtl' : 'ltr';
  const f = formatLocal(opts.expiresAt, opts.timezone ?? 'Asia/Beirut', locale);
  const vars: Record<string, string> = { business: oneLine(opts.businessName), expires: f.when };
  const subject = oneLine(interpolate(m.subject, vars));
  const text = [
    interpolate(m.intro, vars),
    '',
    `${m.accept}: ${opts.acceptUrl}`,
    '',
    interpolate(m.expires, vars),
  ].join('\n');
  const bdi = (v: string) => (rtl ? `<bdi>${escapeHtml(v)}</bdi>` : escapeHtml(v));
  const withVars = (tpl: string) =>
    tpl
      .split(/(\{\w+\})/)
      .map((p) => {
        const k = /^\{(\w+)\}$/.exec(p)?.[1];
        const val = k === undefined ? undefined : vars[k];
        return val === undefined ? escapeHtml(p) : bdi(val);
      })
      .join('');
  const html = [
    '<!doctype html>',
    `<html lang="${rtl ? 'ar' : 'en'}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body dir="${dir}" style="margin:0;padding:16px;background:#f6f5f1;font-family:${emailFontStack(locale)};color:#1b1b1b">`,
    `<div dir="${dir}" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;text-align:start">`,
    `<h1 style="margin:0 0 8px;font-size:20px">${escapeHtml(m.heading)}</h1>`,
    `<p style="margin:0 0 16px">${withVars(m.intro)}</p>`,
    `<p style="margin:0 0 16px"><a href="${escapeHtml(opts.acceptUrl)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#0E7C66;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(m.accept)}</a></p>`,
    `<p style="margin:0;color:#5a5a5a;font-size:13px">${withVars(m.expires)}</p>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
  return { subject, text, html };
}

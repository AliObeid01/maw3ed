import { escapeHtml, interpolate, oneLine } from '@/server/i18n/emailRender';
import { emailFontStack, getEmailMessages, isRtl } from '@/server/i18n/messages';
import { EMAIL_TOKEN_TTL_MS, type EmailTokenKind } from '@/server/domain/emailTokens';

export interface AccountEmailOptions {
  kind: EmailTokenKind;
  /** Built from APP_URL by the caller. It carries the secret token, so it is only ever put in the message. */
  url: string;
  /** Business.locale of the user's business; unknown values use English. */
  locale?: string;
  businessName?: string;
}

/**
 * Verify-your-address and reset-password emails, in the user's business language (right-to-left for Arabic,
 * web-safe font stack, same look as the invite email). Pure. The expiry is stated as a duration, never a
 * clock time, so it needs no timezone. There is never a password in the message.
 */
export function accountEmail(opts: AccountEmailOptions) {
  const locale = opts.locale ?? 'en';
  const all = getEmailMessages(locale);
  const m = all.verify;
  const rtl = isRtl(locale);
  const dir = rtl ? 'rtl' : 'ltr';
  const hours = String(EMAIL_TOKEN_TTL_MS[opts.kind] / 3_600_000);
  const vars: Record<string, string> = {
    business: oneLine(opts.businessName ?? ''),
    hours,
  };
  const subject = oneLine(interpolate(m.subject, vars));
  const expires = interpolate(m.expires, vars);
  const text = [
    interpolate(m.intro, vars),
    '',
    `${m.action}: ${opts.url}`,
    '',
    expires,
    '',
    m.ignore,
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
    `<p style="margin:0 0 16px"><a href="${escapeHtml(opts.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#0E7C66;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(m.action)}</a></p>`,
    `<p style="margin:0 0 8px;color:#5a5a5a;font-size:13px">${withVars(m.expires)}</p>`,
    `<p style="margin:0;color:#5a5a5a;font-size:13px">${escapeHtml(m.ignore)}</p>`,
    '</div>',
    '</body>',
    '</html>',
  ].join('\n');
  return { subject, text, html };
}

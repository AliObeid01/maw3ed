import { escapeHtml, interpolate, oneLine } from '@/server/i18n/emailRender';
import { emailStyles, renderEmailLayout } from '@/server/i18n/emailLayout';
import { getEmailMessages, isRtl } from '@/server/i18n/messages';
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
  const m = opts.kind === 'VERIFY' ? all.verify : all.reset;
  const rtl = isRtl(locale);
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
  const html = renderEmailLayout({
    locale,
    preheader: interpolate(m.intro, vars),
    title: m.heading,
    bodyHtml: `<p style="${emailStyles.p}">${withVars(m.intro)}</p>`,
    cta: { label: m.action, url: opts.url },
    notesHtml: [withVars(m.expires), escapeHtml(m.ignore)],
  });
  return { subject, text, html };
}

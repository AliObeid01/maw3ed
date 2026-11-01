import { escapeHtml, formatLocal, interpolate, oneLine } from '@/server/i18n/emailRender';
import { emailStyles, renderEmailLayout } from '@/server/i18n/emailLayout';
import { getEmailMessages, isRtl } from '@/server/i18n/messages';

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
  const html = renderEmailLayout({
    locale,
    preheader: interpolate(m.intro, vars),
    title: m.heading,
    bodyHtml: `<p style="${emailStyles.p}">${withVars(m.intro)}</p>`,
    cta: { label: m.accept, url: opts.acceptUrl },
    notesHtml: [withVars(m.expires)],
  });
  return { subject, text, html };
}

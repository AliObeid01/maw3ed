import { getServerEnv } from '@/server/env';
import { escapeHtml } from './emailRender';
import { emailFontStack, getEmailMessages, isRtl } from './messages';

/**
 * The ONE shared HTML layout for every transactional email (booking, reminders, waitlist offer, invite, email
 * verification, password reset). Table based with inline styles (the optional <style> block only tightens
 * padding and makes the button full width at phone widths). The only image is the logo in the navy header band
 * (an absolute URL under APP_URL, with alt text on a navy cell so the name stays readable when images are
 * blocked); no remote fonts. Colours are the app tokens in src/app/globals.css; light colour scheme only so
 * dark-mode clients do not invert it. Deterministic for a given APP_URL, so a retried send is byte-identical.
 */
export const EMAIL_COLORS = {
  canvas: '#f3f5fa',
  card: '#ffffff',
  line: '#d3dcee',
  ink: '#0b1938',
  muted: '#56668a',
  brand: '#254edb',
  /** Deep Navy: the header band behind the reverse (white) logo. */
  navy: '#0b1938',
  onBrand: '#ffffff',
} as const;

/** The reverse logo: the 320 px file shown at 160 px (sharp on retina). Served from public/brand. */
export const EMAIL_LOGO_PATH = '/brand/maw3ed-email-logo-reverse-320w.png';
/** Cache-busting version of the logo files (same names, new artwork in PR-16b). Bump when the artwork changes; constant, so retried sends stay byte-identical. */
export const EMAIL_LOGO_VERSION = 3;
export const EMAIL_LOGO_WIDTH = 160;
export const EMAIL_LOGO_HEIGHT = 48;

const C = EMAIL_COLORS;

/** Public origin the logo is fetched from (APP_URL, no trailing slash). Constant for the life of a process. */
export function emailAssetBase(): string {
  return getServerEnv().APP_URL;
}

export interface EmailLink {
  label: string;
  url: string;
}

export interface EmailLayoutOptions {
  locale: string;
  /** Hidden inbox preview text (plain; escaped here). */
  preheader: string;
  /** The h1 (plain; escaped here). */
  title: string;
  /** Trusted HTML shown between the title and the button; callers escape every dynamic value. */
  bodyHtml: string;
  /** The single primary action: a blue button plus a visible copy-paste URL line. */
  cta: EmailLink;
  /** Secondary actions as plain blue text links, in order. */
  secondary?: EmailLink[];
  /** Trusted small muted notes under the actions (link expiry, calendar note, ignore note). */
  notesHtml?: string[];
  /** Trusted footer HTML in small muted text. */
  footerHtml?: string;
}

/** Shared paragraph and note styles so every kind looks the same. */
export const emailStyles = {
  p: `margin:0 0 16px;font-size:16px;line-height:24px;color:${C.ink}`,
  note: `margin:0 0 8px;font-size:13px;line-height:20px;color:${C.muted}`,
};

/** A label/value details box. Values are escaped here and isolated in <bdi> for Arabic. */
export function emailDetails(rows: Array<[string, string]>, rtl: boolean): string {
  const bdi = (v: string) => (rtl ? `<bdi>${escapeHtml(v)}</bdi>` : escapeHtml(v));
  const trs = rows
    .map(
      ([k, v]) =>
        `<tr><td style="width:84px;padding:6px 0;padding-inline-end:12px;font-size:14px;line-height:20px;color:${C.muted};vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;font-size:15px;line-height:20px;font-weight:bold;color:${C.ink};vertical-align:top">${bdi(v)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 24px;background:${C.canvas};border:1px solid ${C.line};border-radius:12px"><tr><td style="padding:10px 16px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${trs}</table></td></tr></table>`;
}

export function renderEmailLayout(o: EmailLayoutOptions): string {
  const rtl = isRtl(o.locale);
  const dir = rtl ? 'rtl' : 'ltr';
  const lang = rtl ? 'ar' : 'en';
  const e = escapeHtml;
  const font = emailFontStack(o.locale);
  const m = getEmailMessages(o.locale);

  const button = `<table role="presentation" class="btn-table" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 0 12px"><tr><td align="center" bgcolor="${C.brand}" style="border-radius:12px;background:${C.brand}"><a href="${e(o.cta.url)}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;line-height:18px;font-weight:bold;color:${C.onBrand};text-decoration:none;border-radius:12px;background:${C.brand};text-align:center">${e(o.cta.label)}</a></td></tr></table>`;
  const fallback = `<p style="margin:0 0 20px;font-size:12px;line-height:18px;color:${C.muted}">${e(m.fallback)}<br><span style="word-break:break-all;overflow-wrap:anywhere;color:${C.ink}">${e(o.cta.url)}</span></p>`;
  const secondary = (o.secondary ?? [])
    .map(
      (l) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:22px"><a href="${e(l.url)}" style="color:${C.brand};font-weight:bold;text-decoration:underline">${e(l.label)}</a></p>`,
    )
    .join('');
  const notes = (o.notesHtml ?? []).map((n) => `<p style="${emailStyles.note}">${n}</p>`).join('');
  const footer = o.footerHtml
    ? `<tr><td class="px" style="padding:20px 8px 0;font-size:12px;line-height:18px;color:${C.muted};text-align:center">${o.footerHtml}</td></tr>`
    : '';

  // Navy band + reverse logo. Inline styles only; the text colour and size keep the alt text readable on navy when
  // the client blocks images. The src is absolute: email clients cannot resolve relative paths.
  const logo = `${emailAssetBase()}${EMAIL_LOGO_PATH}?v=${EMAIL_LOGO_VERSION}`;
  const header = `<tr><td class="px" bgcolor="${C.navy}" style="background:${C.navy};padding:20px 28px;border-radius:16px 16px 0 0;font-family:${font};font-size:22px;line-height:28px;font-weight:bold;color:${C.onBrand};text-align:start"><img src="${e(logo)}" width="${EMAIL_LOGO_WIDTH}" height="${EMAIL_LOGO_HEIGHT}" alt="Maw3ed" style="display:block;border:0;outline:none;text-decoration:none;width:${EMAIL_LOGO_WIDTH}px;height:${EMAIL_LOGO_HEIGHT}px;font-family:${font};font-size:22px;line-height:28px;font-weight:bold;color:${C.onBrand}"></td></tr>`;

  return [
    '<!doctype html>',
    `<html lang="${lang}" dir="${dir}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${e(o.title)}</title>`,
    '<style>:root{color-scheme:light only;supported-color-schemes:light}@media only screen and (max-width:480px){.px{padding-inline-start:16px !important;padding-inline-end:16px !important}.outer{padding:12px 8px !important}.btn-table{width:100% !important}.btn-table a{display:block !important}}</style>',
    '</head>',
    `<body dir="${dir}" style="margin:0;padding:0;background:${C.canvas};font-family:${font};color:${C.ink}">`,
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${e(o.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas}"><tr><td class="outer" align="center" style="padding:28px 12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="max-width:600px;width:100%">`,
    header,
    `<tr><td style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 16px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px" dir="${dir}" style="padding:28px 28px 20px;font-family:${font};text-align:start">`,
    `<h1 style="margin:0 0 12px;font-size:22px;line-height:30px;font-weight:bold;color:${C.ink}">${e(o.title)}</h1>`,
    o.bodyHtml,
    button,
    fallback,
    secondary,
    notes,
    '</td></tr></table></td></tr>',
    footer,
    '</table>',
    '</td></tr></table>',
    '</body>',
    '</html>',
  ].join('\n');
}

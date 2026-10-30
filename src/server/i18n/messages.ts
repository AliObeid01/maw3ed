import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';

export type EmailMessages = typeof en.email;

const catalogues: Record<string, EmailMessages> = { en: en.email, ar: ar.email };

/** The `email` section of messages/{locale}.json for server-rendered mail. Unknown locales use English. */
export function getEmailMessages(locale: string): EmailMessages {
  return catalogues[locale] ?? en.email;
}

export const isRtl = (locale: string) => locale === 'ar';

/** Web-safe stacks: mail clients cannot load web fonts. Arabic prefers faces that ship with the OS. */
export function emailFontStack(locale: string): string {
  return isRtl(locale)
    ? "Tahoma,'Segoe UI','Geeza Pro','Noto Naskh Arabic',Arial,sans-serif"
    : 'Arial,Helvetica,sans-serif';
}

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorView } from '@/components/errors/ErrorView';
import { GlobalErrorDocument } from '@/components/errors/GlobalErrorDocument';
import { ERROR_PAGE, pickErrorLocale } from '@/i18n/errorPage';

const noop = () => {};

describe('crash page copy', () => {
  it('has the same fields in English and Arabic, none empty, and no technical wording', () => {
    expect(Object.keys(ERROR_PAGE.en).sort()).toEqual(Object.keys(ERROR_PAGE.ar).sort());
    for (const locale of ['en', 'ar'] as const) {
      for (const value of Object.values(ERROR_PAGE[locale])) {
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value).not.toMatch(/stack|exception|digest|500|undefined|error:/i);
      }
    }
    expect(ERROR_PAGE.ar.title).toMatch(/[؀-ۿ]/);
  });
});

describe('pickErrorLocale (no provider exists in global-error)', () => {
  it('follows the locale cookie, then the hint, then English', () => {
    expect(pickErrorLocale('locale=ar')).toBe('ar');
    expect(pickErrorLocale('a=1; locale=en; locale_hint=ar')).toBe('en');
    expect(pickErrorLocale('a=1; locale_hint=ar')).toBe('ar');
    expect(pickErrorLocale('locale=fr')).toBe('en');
    expect(pickErrorLocale('')).toBe('en');
    expect(pickErrorLocale('locale=%E0%A4%A')).toBe('en'); // malformed escape: never throws
  });
});

describe('ErrorView', () => {
  it('renders the English card with an alert, a retry button and a link home', () => {
    const html = renderToStaticMarkup(createElement(ErrorView, { locale: 'en', onRetry: noop }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('<h1');
    expect(html).toContain(ERROR_PAGE.en.title);
    expect(html).toContain(ERROR_PAGE.en.body);
    expect(html).toContain(`>${ERROR_PAGE.en.retry}</button>`);
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>Go to Maw3ed<\/a>/);
  });

  it('renders the Arabic copy', () => {
    const html = renderToStaticMarkup(createElement(ErrorView, { locale: 'ar', onRetry: noop }));
    expect(html).toContain(ERROR_PAGE.ar.title);
    expect(html).toContain(ERROR_PAGE.ar.retry);
    expect(html).toContain(ERROR_PAGE.ar.home);
    expect(html).not.toContain(ERROR_PAGE.en.title);
  });

  it('shows no stack trace, error message or digest, and uses logical (RTL-safe) classes only', () => {
    const html = renderToStaticMarkup(createElement(ErrorView, { locale: 'en', onRetry: noop }));
    expect(html).not.toMatch(/\bat \w+ \(|digest|stack/i);
    expect(html).not.toMatch(/class="[^"]*\b(ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });

  it('keeps the tap targets at least 44px (size lg is 50px)', () => {
    const html = renderToStaticMarkup(createElement(ErrorView, { locale: 'en', onRetry: noop }));
    expect(html.match(/h-\[50px\]/g)).toHaveLength(2);
  });
});

describe('GlobalErrorDocument', () => {
  it('renders its own html element: English is ltr', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalErrorDocument, { locale: 'en', onRetry: noop }),
    );
    expect(html.startsWith('<html lang="en" dir="ltr"')).toBe(true);
    expect(html).toContain(ERROR_PAGE.en.title);
  });

  it('Arabic is right-to-left with the Arabic copy', () => {
    const html = renderToStaticMarkup(
      createElement(GlobalErrorDocument, { locale: 'ar', onRetry: noop, className: 'f1 f2' }),
    );
    expect(html.startsWith('<html lang="ar" dir="rtl" class="f1 f2"')).toBe(true);
    expect(html).toContain(ERROR_PAGE.ar.title);
    expect(html).toContain(ERROR_PAGE.ar.body);
  });
});

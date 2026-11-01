import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntlErrorCode, IntlError } from 'next-intl';
import { onIntlError } from '@/components/i18n/IntlBoundary';
import { resetClientReporting, setClientReporter } from '@/lib/observability/clientReport';
import type { ReportContext, Reporter } from '@/lib/observability/report';

const missing = (path: string, locale = 'en') =>
  new IntlError(
    IntlErrorCode.MISSING_MESSAGE,
    `Could not resolve \`${path}\` in messages for locale \`${locale}\`.`,
  );

let sent: { level: string; text: string; ctx: ReportContext }[];
let errors: unknown[];
beforeEach(() => {
  sent = [];
  errors = [];
  const reporter: Reporter = {
    message: (level, text, ctx) => void sent.push({ level, text, ctx }),
    error: (e) => void errors.push(e),
  };
  setClientReporter(reporter);
  vi.stubEnv('NODE_ENV', 'production');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  resetClientReporting();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('onIntlError in production reports to the error service', () => {
  it('reports a missing message once per distinct key, with only the key path and locale', () => {
    onIntlError(missing('booking.title'));
    onIntlError(missing('booking.title'));
    onIntlError(missing('booking.title'));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      level: 'warning',
      text: 'i18n missing message',
      ctx: { code: 'MISSING_MESSAGE', namespace: 'booking', key: 'title', locale: 'en' },
    });
    onIntlError(missing('booking.subtitle'));
    onIntlError(missing('link.cancel.confirm', 'ar'));
    expect(sent).toHaveLength(3);
    expect(sent[2]!.ctx).toEqual({
      code: 'MISSING_MESSAGE',
      namespace: 'link.cancel',
      key: 'confirm',
      locale: 'ar',
    });
  });

  it('counts the same key in another locale as distinct', () => {
    onIntlError(missing('booking.title', 'en'));
    onIntlError(missing('booking.title', 'ar'));
    expect(sent).toHaveLength(2);
  });

  it('reports other next-intl error codes by code and key only, never the raw message', () => {
    onIntlError(
      new IntlError(
        IntlErrorCode.INVALID_MESSAGE,
        'Could not format `booking.price`: Hello a@b.io {name}',
      ),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.ctx).toMatchObject({
      code: 'INVALID_MESSAGE',
      namespace: 'booking',
      key: 'price',
    });
    expect(JSON.stringify(sent[0])).not.toContain('a@b.io');
  });

  it('still logs to the console and never throws in production', () => {
    expect(() => onIntlError(missing('x.y'))).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });

  it('survives a failing reporter', () => {
    setClientReporter({
      message() {
        throw new Error('down');
      },
      error() {},
    });
    expect(() => onIntlError(missing('x.y'))).not.toThrow();
  });

  it('outside production it throws and reports nothing', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => onIntlError(missing('booking.title'))).toThrow();
    expect(sent).toHaveLength(0);
  });
});

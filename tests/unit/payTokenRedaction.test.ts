import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { scrubValue } from '@/lib/observability/scrub';
import { createLogger } from '@/server/http/logger';

/** PR-12: the unpaid-hold fields of My bookings are bearer-like and must never reach logs or the error service. */
describe('payToken and holdExpiresAt are secrets', () => {
  it('pino redacts them at the top level and nested', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger({ level: 'info', destination });
    logger.info({
      payToken: 'PAYTOK-1',
      holdExpiresAt: 'HOLD-1',
      booking: { payToken: 'PAYTOK-2', holdExpiresAt: 'HOLD-2' },
      err: { meta: { payToken: 'PAYTOK-3' } },
    });
    const out = lines.join('');
    for (const s of ['PAYTOK-1', 'HOLD-1', 'PAYTOK-2', 'HOLD-2', 'PAYTOK-3']) expect(out).not.toContain(s);
    expect(out).toContain('[redacted]');
  });

  it('the Sentry scrubber redacts both keys', () => {
    const out = JSON.stringify(
      scrubValue({ payToken: 'AAA', holdExpiresAt: '2026-11-09T10:00:00.000Z', extra: { holdExpiresAt: 'BBB' } }),
    );
    expect(out).not.toContain('AAA');
    expect(out).not.toContain('2026-11-09T10');
    expect(out).not.toContain('BBB');
  });
});

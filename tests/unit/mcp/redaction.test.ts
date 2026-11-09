import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { scrubValue } from '@/lib/observability/scrub';
import { createLogger } from '@/server/http/logger';

/** PR-15a: tool arguments (client name, phone, email, confirmation token) must never reach logs or Sentry. */
describe('assistant tool argument fields are redacted', () => {
  it('pino redacts confirmationToken, phone, email and idempotency keys, top level and nested', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger({ level: 'info', destination });
    logger.info({
      confirmationToken: 'CONFTOK-1',
      phone: '+96171000001',
      email: 'one@example.test',
      args: { confirmationToken: 'CONFTOK-2', phone: '+96171000002', email: 'two@example.test' },
      err: { client: { phone: '+96171000003', email: 'three@example.test' } },
    });
    const out = lines.join('');
    for (const s of [
      'CONFTOK-1',
      'CONFTOK-2',
      '96171000001',
      '96171000002',
      '96171000003',
      'one@example.test',
      'two@example.test',
      'three@example.test',
    ])
      expect(out, s).not.toContain(s);
  });

  it('the Sentry scrubber drops values under those keys, in tool arguments too', () => {
    const scrubbed = JSON.stringify(
      scrubValue({
        params: {
          name: 'tools/call',
          arguments: {
            confirmationToken: 'CONFTOK-9',
            phone: '+96171000009',
            email: 'nine@example.test',
            name: 'Rana Haddad',
          },
        },
      }),
    );
    for (const s of ['CONFTOK-9', '96171000009', 'nine@example.test']) expect(scrubbed, s).not.toContain(s);
  });
});

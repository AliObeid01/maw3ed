import { describe, expect, it } from 'vitest';
import { sanitizeError, scrubEvent, scrubString, scrubUrl } from '@/lib/observability/scrub';
import { signToken } from '@/server/domain/tokens';

const SECRET = 'unit-test-link-secret-0123456789abcdefghij';
const realToken = (kind: 'a' | 'o' = 'a') =>
  signToken(
    kind === 'a'
      ? { a: 'clx1abc2def3ghi4jkl5mno6p', act: 'view', exp: 1893456000 }
      : { o: 'clx1abc2def3ghi4jkl5mno6p', act: 'claim', exp: 1893456000 },
    SECRET,
  );

describe('phones after / and - (blocking 1)', () => {
  it.each([
    ['https://wa.me/96171123456', 'https://wa.me/[phone]'],
    ['wa.me/96171123456?text=hi', 'wa.me/[phone]'],
    ['https://api.whatsapp.com/send?phone=96171123456&text=hi', 'https://api.whatsapp.com/send'],
    ['open tel:+96171123456 now', 'open tel:[phone] now'],
    ['tel:71123456', 'tel:[phone]'],
    ['/api/x/96171123456', '/api/x/[phone]'],
    ['phone-71123456', 'phone-[phone]'],
    ['ref/03123456', 'ref/[phone]'],
  ])('%s', (input, out) => {
    expect(scrubString(input)).toBe(out);
  });

  it('widened local shapes: 3 123 456 and separated international numbers without +', () => {
    expect(scrubString('call 3 123 456 now')).toBe('call [phone] now');
    expect(scrubString('call 44 20 7946 0958 now')).toBe('call [phone] now');
  });

  it('still keeps dates, times, ISO strings, order numbers, request ids and Arabic numerals', () => {
    for (const keep of [
      '2026-11-04',
      '04-11-2026',
      '2026/11/04',
      'on 2026-11-04T09:30:00.000Z ok',
      '2026-11-04 09:30:00',
      '09:30',
      '$15',
      'order #20261104 total $15.50',
      'order 1234567',
      'req 6339d5a4-5d68-4c57-95e2-ef6169d57fcf done',
      'epoch 1793547487170',
      'الساعة 5 مساء بسعر 15$ لـ 3 مواعيد',
      'الطلب رقم ١٢٣٤٥ في ٢٠٢٦/١١/٠٤',
      '/api/appointments/clx1abc2def3ghi4jkl5mno6p/cancel',
    ]) {
      expect(scrubString(keep)).toBe(keep);
    }
  });
});

describe('emails: non-ASCII and encoded (blocking 3)', () => {
  it.each([
    'رنا@gmail.com',
    'رنا@مثال.com',
    'user@مثال.مثال',
    'josé.muñoz@exämple.de',
    'user%40example.com',
    'user%40EXAMPLE.com',
    'user&#64;example.com',
    'user&#x40;example.com',
    'user&commat;example.com',
    'user@example.com',
  ])('%s', (email) => {
    const out = scrubString(`failed for ${email} today`);
    expect(out).toBe('failed for [email] today');
  });

  it('does not eat ordinary text with an at sign or percent signs', () => {
    expect(scrubString('50% off at 5pm')).toBe('50% off at 5pm');
    expect(scrubString('meet @ noon')).toBe('meet @ noon');
  });
});

describe('token API routes and body.sig pairs (4)', () => {
  it.each(['/api/links/', '/api/offers/', '/api/invites/', '/api/pay/'])(
    '%s<real token> is templated, with and without a following segment',
    (prefix) => {
      const t = realToken(prefix === '/api/offers/' ? 'o' : 'a');
      expect(t).toMatch(/^[\w-]+\.[\w-]+$/);
      expect(scrubString(`POST ${prefix}${t} 500`)).toBe(`POST ${prefix}[token] 500`);
      expect(scrubString(`${prefix}${t}/claim`)).toBe(`${prefix}[token]/claim`);
      expect(scrubUrl(`https://maw3ed.com${prefix}${t}?x=1`)).toBe(
        `https://maw3ed.com${prefix}[token]`,
      );
    },
  );

  it('PR-10: /api/links/<view token>/outcome is templated and keeps the trailing segment', () => {
    const t = realToken('a');
    expect(scrubString(`GET /api/links/${t}/outcome 200`)).toBe('GET /api/links/[token]/outcome 200');
    expect(scrubUrl(`https://maw3ed.com/api/links/${t}/outcome?x=1`)).toBe(
      'https://maw3ed.com/api/links/[token]/outcome',
    );
    expect(scrubString(`${t}`)).toBe('[token]');
  });

  it('catches a bare body.sig pair whose halves are 20+ characters, anywhere', () => {
    const t = realToken();
    expect(scrubString(`bad token ${t} given`)).toBe('bad token [token] given');
    const [body, sig] = t.split('.');
    expect(scrubString(`${body!.slice(0, 22)}.${sig!.slice(0, 22)}`)).toBe('[token]');
  });

  it('leaves dotted names with short halves alone', () => {
    expect(scrubString('booking.confirm.title and file.name.js')).toBe(
      'booking.confirm.title and file.name.js',
    );
  });
});

describe('database errors are reduced to codes (blocking 2a)', () => {
  const prismaValidation = {
    name: 'PrismaClientValidationError',
    message:
      'Invalid `prisma.client.create()` invocation:\n{\n  data: {\n    name: "Rana Haddad",\n    phone: "+96171123456",\n    email: "rana@x.com"\n  }\n}\nArgument `businessId` is missing.',
  };
  const prismaKnown = {
    name: 'PrismaClientKnownRequestError',
    code: 'P2002',
    message: 'Unique constraint failed on the fields: (`email`)',
    meta: { target: ['email'], value: 'rana@x.com' },
  };
  const pgUnique = Object.assign(
    new Error('duplicate key value violates unique constraint "Client_email_key"'),
    {
      name: 'error',
      code: '23505',
      severity: 'ERROR',
      detail: 'Key (email)=(rana@x.com) already exists.',
      routine: '_bt_check_unique',
      where: 'x',
      query: 'INSERT INTO "Client" (name) VALUES ($1)',
      parameters: ['Rana Haddad'],
    },
  );

  const event = (type: string, value: string) => ({ exception: { values: [{ type, value }] } });

  it('event: a Prisma validation error keeps only its name', () => {
    const out = scrubEvent(event(prismaValidation.name, prismaValidation.message))!;
    const text = JSON.stringify(out);
    expect(out.exception!.values![0]!.value).toBe('PrismaClientValidationError');
    for (const leak of ['Rana', 'Haddad', 'rana@x.com', '96171123456', 'create()'])
      expect(text).not.toContain(leak);
  });

  it('event: a Prisma known error keeps the code and column names, never values', () => {
    const out = scrubEvent(event(prismaKnown.name, prismaKnown.message))!;
    expect(out.exception!.values![0]!.value).toBe('PrismaClientKnownRequestError (email)');
    // An error already reduced by sanitizeError (the real path) passes through unchanged.
    const again = scrubEvent(
      event('PrismaClientKnownRequestError', 'PrismaClientKnownRequestError P2002 (email)'),
    )!;
    expect(again.exception!.values![0]!.value).toBe('PrismaClientKnownRequestError P2002 (email)');
  });

  it('sanitizeError: Prisma and pg errors become name + code (+ columns), nothing else', () => {
    const v = sanitizeError(
      Object.assign(new Error(prismaValidation.message), { name: prismaValidation.name }),
    );
    expect(v).toBeInstanceOf(Error);
    expect((v as Error).message).toBe('PrismaClientValidationError');
    const k = sanitizeError(Object.assign(new Error(prismaKnown.message), prismaKnown)) as Error;
    expect(k.message).toBe('PrismaClientKnownRequestError P2002 (email)');
    expect(JSON.stringify({ m: k.message, s: k.stack })).not.toContain('rana@x.com');
    const p = sanitizeError(pgUnique) as Error;
    expect(p.message).toBe('error 23505');
    for (const prop of ['detail', 'hint', 'where', 'query', 'parameters', 'routine'])
      expect(prop in p).toBe(false);
    expect(p.message + p.stack).not.toMatch(/rana|Haddad|INSERT/i);
  });

  it('sanitizeError leaves ordinary errors untouched', () => {
    const e = new Error('db exploded');
    expect(sanitizeError(e)).toBe(e);
    expect(sanitizeError('text')).toBe('text');
  });

  it('a pg unique-violation text with Key (col)=(value) is cut even when the class is unknown', () => {
    expect(scrubString('failed. Key (email)=(rana@x.com) already exists.')).toBe(
      'failed. Key (email)=([redacted]) already exists.',
    );
    expect(scrubString('Key (first_name, phone)=(Rana, 71123456) already exists')).toBe(
      'Key (first_name, phone)=([redacted]) already exists',
    );
  });

  it('truncates any exception message over 500 characters', () => {
    const long = `boom ${'word '.repeat(300)}`;
    const out = scrubEvent(event('Error', long))!;
    expect(out.exception!.values![0]!.value!.length).toBeLessThanOrEqual(504);
  });
});

describe('accepted gap: free-text names (documented in docs/ARCHITECTURE.md)', () => {
  it('a name inside a plain error message cannot be detected and is left as is', () => {
    // If this ever changes, update the privacy wording in README.md, ARCHITECTURE.md and HUMAN_TASKS.md.
    expect(scrubString('Booking for Rana Haddad')).toBe('Booking for Rana Haddad');
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PR-6 (retire the unscoped-reader footgun). A barber login (PRACTITIONER) may only see its own staff member's
 * appointments. Every appointment READ in the repository therefore takes a `scope`, except a short, named list
 * of lookups that no barber route reaches (signed-link pages, the pay page, idempotency replay). And no service
 * function that a PRACTITIONER may call is allowed to use one of those.
 */
const ROOT = path.resolve(import.meta.dirname, '../../../src/server');
const repoSource = readFileSync(path.join(ROOT, 'repositories/appointment.repo.ts'), 'utf8');

/**
 * Readers that take no scope on purpose: reached only through a signed token, the pay page, a booking replay, or
 * (countByStaff) the booking path's per-day counts for the "anyone" pick, which return numbers and no rows.
 */
const UNSCOPED_ON_PURPOSE = [
  'findByIdempotencyKey',
  'findForLink',
  'findForPay',
  'businessIdOf',
  'countByStaff',
];

/** `name: (businessId: string, scope: ...` or `name(businessId: string, scope: ...` (possibly across lines). */
function methodsWithParams(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^ {2}(?:async )?(\w+)(?::\s*|)\(\s*([^)]*?)\)\s*(?::[^=]*)?(?:=>|\{)/gms;
  for (const m of source.matchAll(re)) out.set(m[1]!, m[2]!);
  return out;
}

const READER = /^(find|list|get|reminderSources|count)/;

describe('appointment repository readers', () => {
  const methods = methodsWithParams(repoSource);

  it('finds the readers it is supposed to police', () => {
    expect([...methods.keys()]).toEqual(
      expect.arrayContaining(['findById', 'list', 'reminderSources']),
    );
  });

  it('every reader takes a `scope` parameter, except the named token/pay/replay lookups', () => {
    const unscoped = [...methods.entries()]
      .filter(([name, params]) => READER.test(name) && !/\bscope\b/.test(params))
      .map(([name]) => name)
      .filter((name) => !UNSCOPED_ON_PURPOSE.includes(name));
    expect(unscoped).toEqual([]);
  });

  it('the old unscoped names are gone', () => {
    expect(repoSource).not.toMatch(/findByIdInScope/);
    expect(methods.get('findById')).toMatch(/businessId: string,\s*scope: RowScope,\s*id: string/);
  });

  it('scope is applied LAST in the where clause, so another filter cannot widen it', () => {
    const list = /list: \([\s\S]*?\n {4}\}\),/.exec(repoSource)?.[0] ?? '';
    expect(list.indexOf('...scopeWhere(scope)')).toBeGreaterThan(list.indexOf('q.staffId'));
  });
});

const services = readdirSync(path.join(ROOT, 'services'))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ file: f, source: readFileSync(path.join(ROOT, 'services', f), 'utf8') }));

/** Chunks of a service file, one per 2-space-indented method or top-level function. */
function chunks(source: string): string[] {
  return source.split(/\n(?= {2}(?:async )?\w+\(|(?:export )?(?:async )?function )/);
}
const allowsPractitioner = (chunk: string) =>
  /requireRole\([^)]*['"]PRACTITIONER['"][^)]*\)/.test(chunk);

describe('services a PRACTITIONER may call', () => {
  it('finds the practitioner-enabled service functions (so the scan is not vacuous)', () => {
    const enabled = services.flatMap((s) => chunks(s.source).filter(allowsPractitioner));
    expect(enabled.length).toBeGreaterThanOrEqual(3);
  });

  it('use only scoped appointment readers (or other repositories that take the scope)', () => {
    const scoped = new Set(
      [...methodsWithParams(repoSource).entries()]
        .filter(([, params]) => /\bscope\b/.test(params))
        .map(([name]) => name),
    );
    const bad: string[] = [];
    for (const s of services)
      for (const chunk of chunks(s.source).filter(allowsPractitioner))
        for (const m of chunk.matchAll(/appointmentRepo\.(\w+)\(/g))
          if (!scoped.has(m[1]!)) bad.push(`${s.file}: appointmentRepo.${m[1]} is not scoped`);
    expect(bad).toEqual([]);
  });

  it('never call one of the deliberately unscoped lookups', () => {
    const bad: string[] = [];
    for (const s of services)
      for (const chunk of chunks(s.source).filter(allowsPractitioner))
        for (const name of UNSCOPED_ON_PURPOSE)
          if (chunk.includes(`appointmentRepo.${name}(`)) bad.push(`${s.file}: ${name}`);
    expect(bad).toEqual([]);
  });

  it('the scan itself catches an unscoped call (self-test on a synthetic service)', () => {
    const synthetic = `export const svc = {\n  async get(ctx) {\n    requireRole(ctx, 'OWNER', 'PRACTITIONER');\n    return appointmentRepo.findForLink(ctx.businessId, id);\n  },\n  async other(ctx) {\n    requireRole(ctx, 'OWNER');\n    return appointmentRepo.findForLink(ctx.businessId, id);\n  },\n};`;
    const hits = chunks(synthetic)
      .filter(allowsPractitioner)
      .flatMap((c) => UNSCOPED_ON_PURPOSE.filter((n) => c.includes(`appointmentRepo.${n}(`)));
    expect(hits).toEqual(['findForLink']);
  });
});

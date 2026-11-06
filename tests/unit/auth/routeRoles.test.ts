import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { practitionerMayView } from '@/lib/auth/practitionerPaths';

/**
 * Default-deny for the PRACTITIONER role, checked on the source of every route handler: a session route must
 * list its roles, and no roles list may contain PRACTITIONER. The only session routes without a list are the
 * self-service ones below (they only touch the caller's own account). Adding a route that forgets `roles`
 * fails here, so a new role can never leak in through a missing list.
 */
const API = path.resolve(import.meta.dirname, '../../../src/app/api');
const SELF_SERVICE = new Set([
  'auth/change-password',
  'auth/logout',
  'auth/resend-verification',
  'auth/sign-out-others',
  'me',
]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === 'route.ts' ? [full] : [];
  });
}

const handlers = routeFiles(API).flatMap((file) => {
  const rel = path.relative(API, path.dirname(file)).split(path.sep).join('/');
  const src = readFileSync(file, 'utf8');
  return src
    .split(/^export const (?=(?:GET|POST|PUT|PATCH|DELETE) = withRoute)/m)
    .slice(1)
    .map((chunk) => ({ rel, method: chunk.slice(0, chunk.indexOf(' ')), chunk }));
});

describe('route roles (default-deny)', () => {
  it('found the route handlers', () => {
    expect(handlers.length).toBeGreaterThan(60);
  });

  it('every session route lists roles unless it is self-service', () => {
    const missing = handlers
      .filter((h) => /auth:\s*'session'/.test(h.chunk) && !/roles:\s*\[/.test(h.chunk))
      .filter((h) => !SELF_SERVICE.has(h.rel))
      .map((h) => `${h.method} /api/${h.rel}`);
    expect(missing).toEqual([]);
  });

  it('exactly the self-service routes have no roles list', () => {
    const open = new Set(
      handlers
        .filter((h) => /auth:\s*'session'/.test(h.chunk) && !/roles:\s*\[/.test(h.chunk))
        .map((h) => h.rel),
    );
    expect([...open].sort()).toEqual([...SELF_SERVICE].sort());
  });

  it('no roles list names PRACTITIONER yet (PR-5 adds narrow scoped routes explicitly)', () => {
    const bad = handlers.filter((h) => /roles:\s*\[[^\]]*PRACTITIONER/.test(h.chunk)).map((h) => h.rel);
    expect(bad).toEqual([]);
  });
});

describe('practitionerMayView', () => {
  it.each(['/app/welcome', '/app/account', '/app/account/', '/app/welcome?x=1'])('allows %s', (p) =>
    expect(practitionerMayView(p)).toBe(true),
  );
  it.each(['/app', '/app/staff', '/app/appointments/abc', '/app/accounts', '/app/welcomex', '/'])(
    'denies %s',
    (p) => expect(practitionerMayView(p)).toBe(false),
  );
});

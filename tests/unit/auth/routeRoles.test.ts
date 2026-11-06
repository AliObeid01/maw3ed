import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { practitionerMayView } from '@/lib/auth/practitionerPaths';

/**
 * Default-deny for the PRACTITIONER role, checked on the source of every route handler: a session route must
 * list its roles, and PRACTITIONER may appear in exactly the scoped routes below. The only session routes without
 * a list are the self-service ones (they only touch the caller's own account). Adding a route that forgets `roles`
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
/** PR-5: the barber's scoped routes. Their services filter every query by the staff member linked to the login. */
const SCOPED = [
  'GET appointments/[id]',
  'GET dashboard/today',
  'GET outcomes/queue',
  'PATCH appointments/[id]/outcome',
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === 'route.ts' ? [full] : [];
  });
}

/** Source without comments, so text inside a comment can never satisfy or mask a check (URLs in strings survive). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** The names inside `roles: [...]`, or null when the handler has no roles list. */
function rolesOf(chunk: string): string[] | null {
  const match = /roles:\s*\[([^\]]*)\]/.exec(stripComments(chunk));
  return match ? [...match[1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!) : null;
}

const files = routeFiles(API);
const handlers = files.flatMap((file) => {
  const rel = path.relative(API, path.dirname(file)).split(path.sep).join('/');
  const src = readFileSync(file, 'utf8');
  return stripComments(src)
    .split(/^export const (?=(?:GET|POST|PUT|PATCH|DELETE) = withRoute)/m)
    .slice(1)
    .map((chunk) => ({ rel, method: chunk.slice(0, chunk.indexOf(' ')), chunk }));
});
const isSession = (h: { chunk: string }) => /auth:\s*'session'/.test(h.chunk);

describe('route scan', () => {
  it('finds every handler: as many as there are withRoute( calls in the route files', () => {
    const calls = files.reduce(
      (n, f) => n + (stripComments(readFileSync(f, 'utf8')).match(/\bwithRoute\s*\(/g)?.length ?? 0),
      0,
    );
    expect(handlers.length).toBeGreaterThan(60);
    expect(handlers.length).toBe(calls);
  });

  it('a comment containing "roles: [" cannot satisfy or mask the check', () => {
    const masked = `// roles: ['OWNER']\nexport const GET = withRoute({ auth: 'session' }, async () => ok(1));`;
    expect(rolesOf(masked)).toBeNull();
    const block = `/* roles: ['OWNER', 'PRACTITIONER'] */\nexport const GET = withRoute({ auth: 'session', roles: ['OWNER'] }, h);`;
    expect(rolesOf(block)).toEqual(['OWNER']);
    expect(stripComments("const url = 'https://x.test/a'; // roles: ['STAFF']")).toContain(
      'https://x.test/a',
    );
  });
});

describe('route roles (default-deny)', () => {
  it('every session route lists roles unless it is self-service', () => {
    const missing = handlers
      .filter((h) => isSession(h) && rolesOf(h.chunk) === null)
      .filter((h) => !SELF_SERVICE.has(h.rel))
      .map((h) => `${h.method} /api/${h.rel}`);
    expect(missing).toEqual([]);
  });

  it('exactly the self-service routes have no roles list', () => {
    const open = new Set(
      handlers.filter((h) => isSession(h) && rolesOf(h.chunk) === null).map((h) => h.rel),
    );
    expect([...open].sort()).toEqual([...SELF_SERVICE].sort());
  });

  it('PRACTITIONER is named in exactly the four scoped routes and nowhere else', () => {
    const named = handlers
      .filter((h) => rolesOf(h.chunk)?.includes('PRACTITIONER'))
      .map((h) => `${h.method} ${h.rel}`);
    expect(named.sort()).toEqual([...SCOPED].sort());
  });

  it('a scoped route lists OWNER and STAFF too, and no list names a role outside the three', () => {
    for (const h of handlers) {
      const roles = rolesOf(h.chunk);
      if (!roles) continue;
      expect(
        roles.every((r) => ['OWNER', 'STAFF', 'PRACTITIONER'].includes(r)),
        `${h.method} ${h.rel}`,
      ).toBe(true);
      if (roles.includes('PRACTITIONER')) expect(roles).toEqual(['OWNER', 'STAFF', 'PRACTITIONER']);
    }
  });
});

describe('practitionerMayView', () => {
  it.each([
    '/app/today',
    '/app/today?x=1',
    '/app/outcomes',
    '/app/outcomes/',
    '/app/appointments/abc123',
    '/app/account',
    '/app/account/',
  ])('allows %s', (p) => expect(practitionerMayView(p)).toBe(true));
  it.each([
    '/app',
    '/app/welcome',
    '/app/staff',
    '/app/clients',
    '/app/clients/abc',
    '/app/book',
    '/app/appointments',
    '/app/appointments/a/b',
    '/app/accounts',
    '/app/account/extra',
    '/app/todayx',
    '/app/outcomesx',
    '/app/today/../staff',
    '/',
    '',
  ])('denies %s', (p) => expect(practitionerMayView(p)).toBe(false));
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRACTITIONER_HOME, practitionerGate } from '@/lib/auth/practitionerPaths';

/**
 * PR-5 hardening of the PR-4 guard. The layout alone is not enough (a client-side soft navigation does not re-run
 * layouts), and a missing path header must not let a barber through. So: (1) a pure gate that fails CLOSED, (2) every
 * server page under src/app/app calls `assertPractitionerPath()` with its own path, (3) the layout fails closed.
 */
describe('practitionerGate', () => {
  it('lets owners and receptionists through whatever the path (or its absence)', () => {
    for (const role of ['OWNER', 'STAFF'])
      for (const p of ['/app/staff', '/app', null, undefined, ''])
        expect(practitionerGate(role, p)).toEqual({ kind: 'allow' });
  });
  it('lets a barber open their own pages', () => {
    for (const p of ['/app/today', '/app/outcomes', '/app/appointments/abc', '/app/account'])
      expect(practitionerGate('PRACTITIONER', p)).toEqual({ kind: 'allow' });
  });
  it('sends a barber from any other page to Today', () => {
    for (const p of [
      '/app',
      '/app/staff',
      '/app/clients/x',
      '/app/welcome',
      '/app/book',
      '/api/me',
    ])
      expect(practitionerGate('PRACTITIONER', p)).toEqual({
        kind: 'redirect',
        to: PRACTITIONER_HOME,
      });
  });
  it('FAILS CLOSED when the path is unknown (no redirect either: that would loop on an allowed page)', () => {
    for (const p of [null, undefined, ''])
      expect(practitionerGate('PRACTITIONER', p)).toEqual({ kind: 'forbidden' });
  });
  it('the home page is itself allowed, so a redirect to it can never loop', () => {
    expect(practitionerGate('PRACTITIONER', PRACTITIONER_HOME)).toEqual({ kind: 'allow' });
  });
});

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
let role = 'OWNER';
vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('@/app/app/loadSession', () => ({ loadSession: async () => ({ role }) }));

describe('assertPractitionerPath (server pages)', () => {
  beforeEach(() => {
    redirect.mockClear();
  });

  it('does nothing for an owner on an owner page', async () => {
    role = 'OWNER';
    const { assertPractitionerPath } = await import('@/app/app/practitionerGuard');
    await expect(assertPractitionerPath('/app/staff')).resolves.toMatchObject({ role: 'OWNER' });
    expect(redirect).not.toHaveBeenCalled();
  });
  it('redirects a barber who soft-navigated to an owner page', async () => {
    role = 'PRACTITIONER';
    const { assertPractitionerPath } = await import('@/app/app/practitionerGuard');
    await expect(assertPractitionerPath('/app/staff')).rejects.toThrow('REDIRECT /app/today');
    await expect(assertPractitionerPath('/app/clients/abc')).rejects.toThrow('REDIRECT /app/today');
    await expect(assertPractitionerPath('/app')).rejects.toThrow('REDIRECT /app/today');
  });
  it('lets a barber open their own pages', async () => {
    role = 'PRACTITIONER';
    const { assertPractitionerPath } = await import('@/app/app/practitionerGuard');
    for (const p of ['/app/today', '/app/outcomes', '/app/appointments/abc', '/app/account'])
      await expect(assertPractitionerPath(p)).resolves.toMatchObject({ role: 'PRACTITIONER' });
    expect(redirect).not.toHaveBeenCalled();
  });
  it('treats an empty path as a bug and sends the barber home instead of rendering', async () => {
    role = 'PRACTITIONER';
    const { assertPractitionerPath } = await import('@/app/app/practitionerGuard');
    await expect(assertPractitionerPath('')).rejects.toThrow('REDIRECT /app/today');
  });
});

const APP = path.resolve(import.meta.dirname, '../../../src/app/app');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

/**
 * The path a page MUST pass to assertPractitionerPath, derived from where the file lives:
 * `src/app/app/clients/[id]/page.tsx` -> `/app/clients/${id}`, `src/app/app/page.tsx` -> `/app`.
 * Route groups `(x)` do not appear in a URL.
 */
function expectedGuardPath(relFromApp: string): string {
  const segments = relFromApp
    .split(path.sep)
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s) => s.replace(/^\[(\w+)\]$/, '${$1}'));
  return ['/app', ...segments].join('/');
}

/** Problems with one file's guard call (empty = fine). Pure: takes the source text. */
function guardProblems(relFromApp: string, source: string): string[] {
  const want = expectedGuardPath(relFromApp);
  const call = /await assertPractitionerPath\(\s*([`'"])(\/app[^`'"]*)\1\s*\)/.exec(source);
  if (!call) return [`${relFromApp}: no await assertPractitionerPath('<own path>') call`];
  if (call[2] !== want)
    return [`${relFromApp}: asserts "${call[2]}" but the file lives at "${want}"`];
  if (call[1] !== '`' && want.includes('${'))
    return [`${relFromApp}: a dynamic path must be a template literal`];
  return [];
}

/** loading / error / not-found / template files render for a barber too: they must not load owner data. */
function stateFileProblems(relFromApp: string, source: string): string[] {
  const loads = /from\s+['"](@\/server\/|@\/app\/app\/loadSession)|loadSession\(/.test(source);
  return loads
    ? [`${relFromApp}: a state file must not import server data or the session loader`]
    : [];
}

describe('every server page under src/app/app (PR-6: derived path, nested files)', () => {
  const files = walk(APP);
  const rel = (f: string) => path.relative(APP, f);
  const pages = files.filter((f) => path.basename(f) === 'page.tsx');
  const nestedLayouts = files.filter(
    (f) => path.basename(f) === 'layout.tsx' && path.dirname(f) !== APP,
  );
  const stateFiles = files.filter((f) =>
    ['loading.tsx', 'error.tsx', 'not-found.tsx', 'template.tsx'].includes(path.basename(f)),
  );

  it('derives the expected path from the file path', () => {
    expect(expectedGuardPath(path.join('page.tsx'))).toBe('/app');
    expect(expectedGuardPath(path.join('staff', 'page.tsx'))).toBe('/app/staff');
    expect(expectedGuardPath(path.join('clients', '[id]', 'page.tsx'))).toBe('/app/clients/${id}');
    expect(expectedGuardPath(path.join('(group)', 'x', 'page.tsx'))).toBe('/app/x');
  });

  it('a page asserting the wrong path fails, a missing call fails, a correct one passes', () => {
    const f = path.join('clients', '[id]', 'page.tsx');
    expect(guardProblems(f, 'await assertPractitionerPath(`/app/clients/${id}`);')).toEqual([]);
    expect(guardProblems(f, "await assertPractitionerPath('/app/clients');")).toHaveLength(1);
    expect(guardProblems(f, 'await assertPractitionerPath(`/app/staff/${id}`);')).toHaveLength(1);
    expect(guardProblems(f, 'await assertPractitionerPath("/app/clients/${id}");')).toHaveLength(1);
    expect(guardProblems(f, 'const x = 1;')).toHaveLength(1);
    expect(guardProblems(path.join('page.tsx'), "await assertPractitionerPath('/app');")).toEqual(
      [],
    );
    expect(
      guardProblems(path.join('page.tsx'), "await assertPractitionerPath('/app/today');"),
    ).toHaveLength(1);
  });

  it('state files that load server data are flagged', () => {
    expect(
      stateFileProblems('x/loading.tsx', "import { db } from '@/server/repositories/db';"),
    ).toHaveLength(1);
    expect(
      stateFileProblems('x/error.tsx', "import { loadSession } from '@/app/app/loadSession';"),
    ).toHaveLength(1);
    expect(
      stateFileProblems('x/loading.tsx', "import { Skeleton } from '@/components/ui/Skeleton';"),
    ).toEqual([]);
  });

  it('every page asserts exactly its own path', () => {
    expect(pages.length).toBeGreaterThan(15);
    const problems = pages.flatMap((f) => guardProblems(rel(f), readFileSync(f, 'utf8')));
    expect(problems).toEqual([]);
  });

  it('every nested layout asserts its own path too (the root layout is the header gate, checked below)', () => {
    const problems = nestedLayouts.flatMap((f) => guardProblems(rel(f), readFileSync(f, 'utf8')));
    expect(problems).toEqual([]);
  });

  it('loading / error / not-found / template files load no server data', () => {
    const problems = stateFiles.flatMap((f) => stateFileProblems(rel(f), readFileSync(f, 'utf8')));
    expect(problems).toEqual([]);
  });

  it('the layout fails closed: no "path && ..." shortcut, and a missing header renders the forbidden state', () => {
    const layout = readFileSync(path.join(APP, 'layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/path\s*&&\s*!practitionerMayView/);
    expect(layout).toContain('practitionerGate(');
    expect(layout).toMatch(/kind === 'forbidden'/);
  });
});

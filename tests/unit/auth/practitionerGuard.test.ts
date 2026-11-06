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
    for (const p of ['/app', '/app/staff', '/app/clients/x', '/app/welcome', '/app/book', '/api/me'])
      expect(practitionerGate('PRACTITIONER', p)).toEqual({ kind: 'redirect', to: PRACTITIONER_HOME });
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
  it("lets a barber open their own pages", async () => {
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

describe('every server page under src/app/app', () => {
  const APP = path.resolve(import.meta.dirname, '../../../src/app/app');
  const pages = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      return statSync(full).isDirectory() ? pages(full) : name === 'page.tsx' ? [full] : [];
    });

  it('calls assertPractitionerPath() with a literal path of its own', () => {
    const all = pages(APP);
    expect(all.length).toBeGreaterThan(15);
    const missing = all
      .filter((f) => !/await assertPractitionerPath\(\s*[`'"]\/app/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(APP, f));
    expect(missing).toEqual([]);
  });

  it('the layout fails closed: no "path && ..." shortcut, and a missing header renders the forbidden state', () => {
    const layout = readFileSync(path.join(APP, 'layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/path\s*&&\s*!practitionerMayView/);
    expect(layout).toContain('practitionerGate(');
    expect(layout).toMatch(/kind === 'forbidden'/);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { requireRole, resolveSession } from '@/server/http/auth';
import { clearSessionCookie, readSessionToken, sessionCookie } from '@/server/http/cookies';
import { AppError } from '@/server/http/errors';
import { sha256Hex } from '@/server/services/crypto';
import { sessionService, type SessionStore } from '@/server/services/session';

const NOW = new Date('2026-11-01T10:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function storeWith(
  row: { expiresAt: Date; lastSeenAt: Date; createdAt?: Date } | null,
  role: 'OWNER' | 'STAFF' | null = 'OWNER',
) {
  const touch = vi.fn(async () => {});
  const findByTokenHash = vi.fn(async (hash: string) =>
    row && hash === sha256Hex('good-token')
      ? {
          id: 's1',
          userId: 'u1',
          businessId: 'b1',
          createdAt: new Date(NOW.getTime() - DAY),
          ...row,
        }
      : null,
  );
  const store: SessionStore = {
    findByTokenHash,
    touch,
    findRole: async () => (role ? { role } : null),
  };
  return { store, touch, findByTokenHash };
}

describe('sessionService.resolve', () => {
  it('looks the session up by the sha256 of the token, never the raw token', async () => {
    const { store, findByTokenHash } = storeWith({
      expiresAt: new Date(NOW.getTime() + DAY),
      lastSeenAt: NOW,
    });
    await sessionService.resolve('good-token', NOW, store);
    expect(findByTokenHash).toHaveBeenCalledWith(sha256Hex('good-token'));
  });

  it('resolves a live session with the role from Membership', async () => {
    const { store } = storeWith(
      { expiresAt: new Date(NOW.getTime() + DAY), lastSeenAt: NOW },
      'STAFF',
    );
    expect(await sessionService.resolve('good-token', NOW, store)).toEqual({
      sessionId: 's1',
      userId: 'u1',
      businessId: 'b1',
      role: 'STAFF',
    });
  });

  it('rejects unknown tokens, expired sessions and sessions whose membership is gone', async () => {
    const live = { expiresAt: new Date(NOW.getTime() + DAY), lastSeenAt: NOW };
    expect(await sessionService.resolve('other', NOW, storeWith(live).store)).toBeUndefined();
    const expired = { expiresAt: new Date(NOW.getTime() - 1), lastSeenAt: NOW };
    expect(
      await sessionService.resolve('good-token', NOW, storeWith(expired).store),
    ).toBeUndefined();
    expect(
      await sessionService.resolve('good-token', NOW, storeWith(live, null).store),
    ).toBeUndefined();
  });

  it('slides the expiry at most once an hour', async () => {
    const fresh = storeWith({
      expiresAt: new Date(NOW.getTime() + 20 * DAY),
      lastSeenAt: new Date(NOW.getTime() - 30 * 60 * 1000),
    });
    const a = await sessionService.resolve('good-token', NOW, fresh.store);
    expect(a?.refreshed).toBeUndefined();
    expect(fresh.touch).not.toHaveBeenCalled();

    const stale = storeWith({
      expiresAt: new Date(NOW.getTime() + 20 * DAY),
      lastSeenAt: new Date(NOW.getTime() - 61 * 60 * 1000),
    });
    const b = await sessionService.resolve('good-token', NOW, stale.store);
    expect(b?.refreshed?.expiresAt).toEqual(new Date(NOW.getTime() + 30 * DAY));
    expect(stale.touch).toHaveBeenCalledWith('b1', 's1', NOW, new Date(NOW.getTime() + 30 * DAY));
  });
});

describe('absolute session lifetime (90 days)', () => {
  const ABS = 90 * DAY;
  it('rejects a session older than 90 days even when its sliding expiry is still in the future', async () => {
    const row = {
      createdAt: new Date(NOW.getTime() - ABS),
      expiresAt: new Date(NOW.getTime() + 20 * DAY),
      lastSeenAt: NOW,
    };
    expect(await sessionService.resolve('good-token', NOW, storeWith(row).store)).toBeUndefined();
    const justInside = { ...row, createdAt: new Date(NOW.getTime() - ABS + 1) };
    expect(
      await sessionService.resolve('good-token', NOW, storeWith(justInside).store),
    ).toMatchObject({ sessionId: 's1' });
  });

  it('never slides the expiry past createdAt + 90 days', async () => {
    const createdAt = new Date(NOW.getTime() - 80 * DAY);
    const s = storeWith({
      createdAt,
      expiresAt: new Date(NOW.getTime() + 5 * DAY),
      lastSeenAt: new Date(NOW.getTime() - 2 * HOUR),
    });
    const r = await sessionService.resolve('good-token', NOW, s.store);
    const end = new Date(createdAt.getTime() + ABS);
    expect(r?.refreshed?.expiresAt).toEqual(end);
    expect(s.touch).toHaveBeenCalledWith('b1', 's1', NOW, end);
  });
});

describe('resolveSession (the http guard)', () => {
  it('401s without a cookie, with an unrelated cookie, and with an unknown token', async () => {
    const spy = vi.spyOn(sessionService, 'resolve').mockResolvedValue(undefined);
    for (const headers of [{}, { cookie: 'other=1' }, { cookie: 'maw3ed_session=nope' }] as Record<
      string,
      string
    >[]) {
      await expect(
        resolveSession(new Request('http://localhost/x', { headers })),
      ).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    }
    spy.mockRestore();
  });

  it('returns the identity and a refresh instruction when the session slid', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * DAY);
    const spy = vi.spyOn(sessionService, 'resolve').mockResolvedValue({
      sessionId: 's1',
      userId: 'u1',
      businessId: 'b1',
      role: 'OWNER',
      refreshed: { expiresAt },
    });
    const id = await resolveSession(
      new Request('http://localhost/x', { headers: { cookie: 'a=1; maw3ed_session=tok; b=2' } }),
    );
    expect(spy).toHaveBeenCalledWith('tok', expect.any(Date));
    expect(id).toEqual({
      sessionId: 's1',
      userId: 'u1',
      businessId: 'b1',
      role: 'OWNER',
      refresh: { token: 'tok', expiresAt },
    });
    spy.mockRestore();
  });
});

describe('requireRole', () => {
  it('allows the listed role', () => {
    expect(() => requireRole({ role: 'OWNER' }, 'OWNER')).not.toThrow();
  });
  it('throws forbidden for another role or none', () => {
    for (const ctx of [{ role: 'STAFF' as const }, {}]) {
      try {
        requireRole(ctx, 'OWNER');
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).status).toBe(403);
      }
    }
  });
});

describe('session cookie', () => {
  it('is httpOnly, Lax, Path=/ and 30 days', () => {
    const c = sessionCookie('tok', new Date(NOW.getTime() + 30 * DAY), NOW);
    expect(c).toContain('maw3ed_session=tok');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain(`Max-Age=${30 * 24 * 3600}`);
  });

  it('is Secure only in production', () => {
    const exp = new Date(NOW.getTime() + DAY);
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookie('t', exp, NOW)).toContain('Secure');
    expect(clearSessionCookie()).toContain('Secure');
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookie('t', exp, NOW)).not.toContain('Secure');
    vi.unstubAllEnvs();
  });

  it('clear expires immediately', () => {
    expect(clearSessionCookie()).toMatch(/^maw3ed_session=;.*Max-Age=0/);
  });

  it('reads only the named cookie', () => {
    expect(readSessionToken('a=1; maw3ed_session=abc; b=2')).toBe('abc');
    expect(readSessionToken('xmaw3ed_session=abc')).toBeUndefined();
    expect(readSessionToken('maw3ed_session=')).toBeUndefined();
    expect(readSessionToken(null)).toBeUndefined();
  });
});

describe('cookie name', () => {
  it('uses the __Host- prefix in production (Secure, Path=/, no Domain) and the plain name otherwise', () => {
    const exp = new Date(NOW.getTime() + DAY);
    vi.stubEnv('NODE_ENV', 'production');
    const c = sessionCookie('tok', exp, NOW);
    expect(c).toMatch(/^__Host-maw3ed_session=tok;/);
    expect(c).toContain('Secure');
    expect(c).toContain('Path=/');
    expect(c).not.toContain('Domain');
    expect(clearSessionCookie()).toMatch(/^__Host-maw3ed_session=;/);
    expect(readSessionToken('__Host-maw3ed_session=abc')).toBe('abc');
    expect(readSessionToken('maw3ed_session=abc')).toBeUndefined();
    vi.stubEnv('NODE_ENV', 'development');
    expect(sessionCookie('tok', exp, NOW)).toMatch(/^maw3ed_session=tok;/);
    expect(readSessionToken('__Host-maw3ed_session=abc')).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

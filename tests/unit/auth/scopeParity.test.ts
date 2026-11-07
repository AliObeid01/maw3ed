import { describe, expect, it, vi } from 'vitest';

let linked: string | null = null;
const linkedStaffId = vi.fn(async () => linked);
vi.mock('@/server/repositories/staff.repo', () => ({
  staffRepo: { linkedStaffId: () => linkedStaffId() },
}));

const ctx = (role: string) =>
  ({ role, businessId: 'b1', userId: 'u1', requestId: 'r', logger: {} }) as never;

describe('resolveScopeForRead (timing parity of the refusals)', () => {
  it('an unlinked barber runs the stand-in row lookup with a scope that matches nothing, then gets 403', async () => {
    const { resolveScopeForRead, NO_MATCH_SCOPE } = await import('@/server/services/scope');
    linked = null;
    const lookup = vi.fn(async () => null);
    await expect(resolveScopeForRead(ctx('PRACTITIONER'), lookup)).rejects.toMatchObject({
      status: 403,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(NO_MATCH_SCOPE);
    expect(NO_MATCH_SCOPE).toEqual({ kind: 'own', staffId: '' });
  });

  it('a linked barber and an owner do not run the stand-in (the real lookup follows in the service)', async () => {
    const { resolveScopeForRead } = await import('@/server/services/scope');
    const lookup = vi.fn(async () => null);
    linked = 'staff-1';
    await expect(resolveScopeForRead(ctx('PRACTITIONER'), lookup)).resolves.toEqual({
      kind: 'own',
      staffId: 'staff-1',
    });
    await expect(resolveScopeForRead(ctx('OWNER'), lookup)).resolves.toEqual({ kind: 'all' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('a failing stand-in lookup does not turn the 403 into something else', async () => {
    const { resolveScopeForRead } = await import('@/server/services/scope');
    linked = null;
    await expect(
      resolveScopeForRead(ctx('PRACTITIONER'), async () => {
        throw new Error('db down');
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

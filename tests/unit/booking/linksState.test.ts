import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/auth';
import { getLink, postLinkAction, type LinkView } from '@/lib/api/links';
import {
  buttonsFor,
  cancelNoteKind,
  classifyLinkError,
  screenFor,
  screenForResult,
} from '@/lib/links/state';

const link = (patch: Partial<LinkView> & { status?: LinkView['appointment']['status'] } = {}): LinkView => {
  const { status, ...rest } = patch;
  return {
    act: 'view',
    appointment: {
      id: 'a1',
      startAt: '2026-11-03T08:30:00Z',
      endAt: '2026-11-03T09:00:00Z',
      status: status ?? 'BOOKED',
      service: { id: 's1', name: 'Haircut', durationMin: 30, price: 15 },
      staff: { id: 'p1', displayName: 'Karim' },
    },
    business: { name: 'Studio Nour', slug: 'studio-nour', timezone: 'Asia/Beirut', locale: 'en' },
    canConfirm: true,
    canCancel: true,
    cancelCutoffAt: '2026-11-02T08:30:00Z',
    pastCutoff: false,
    confirmedAt: null,
    ...rest,
  };
};

describe('buttonsFor: which button is primary per token', () => {
  it('confirm token: confirm is primary and first, cancel secondary', () => {
    expect(buttonsFor(link({ act: 'confirm' }))).toEqual([
      { action: 'confirm', primary: true },
      { action: 'cancel', primary: false },
    ]);
  });

  it('cancel token: cancel is primary and first', () => {
    expect(buttonsFor(link({ act: 'cancel' }))).toEqual([
      { action: 'cancel', primary: true },
      { action: 'confirm', primary: false },
    ]);
  });

  it('view token: both, confirm first', () => {
    expect(buttonsFor(link({ act: 'view' })).map((b) => b.action)).toEqual(['confirm', 'cancel']);
  });

  it('offers only what the appointment allows, and the remaining one becomes primary', () => {
    expect(buttonsFor(link({ act: 'confirm', canConfirm: false }))).toEqual([
      { action: 'cancel', primary: true },
    ]);
    expect(buttonsFor(link({ act: 'cancel', canCancel: false }))).toEqual([
      { action: 'confirm', primary: true },
    ]);
    expect(buttonsFor(link({ canConfirm: false, canCancel: false }))).toEqual([]);
  });
});

describe('screens', () => {
  it('derives the screen from the appointment status', () => {
    expect(screenFor(link({ status: 'BOOKED' }))).toBe('actionable');
    expect(screenFor(link({ status: 'CONFIRMED' }))).toBe('actionable');
    expect(screenFor(link({ status: 'CANCELLED' }))).toBe('cancelled');
    expect(screenFor(link({ status: 'LATE_CANCEL' }))).toBe('lateCancelled');
    expect(screenFor(link({ status: 'ATTENDED' }))).toBe('over');
    expect(screenFor(link({ status: 'NO_SHOW' }))).toBe('over');
  });

  it('derives the screen from an action result', () => {
    expect(screenForResult('confirmed')).toBe('confirmed');
    expect(screenForResult('already_confirmed')).toBe('confirmed');
    expect(screenForResult('cancelled')).toBe('cancelled');
    expect(screenForResult('already_cancelled')).toBe('cancelled');
    expect(screenForResult('late_cancelled')).toBe('lateCancelled');
  });

  it('words the cancel dialog by cutoff', () => {
    expect(cancelNoteKind({ pastCutoff: false })).toBe('free');
    expect(cancelNoteKind({ pastCutoff: true })).toBe('late');
  });
});

describe('classifyLinkError', () => {
  it('maps the documented statuses', () => {
    expect(classifyLinkError(new ApiError(404, 'NOT_FOUND', ''))).toBe('invalid');
    expect(classifyLinkError(new ApiError(410, 'LINK_EXPIRED', ''))).toBe('expired');
    expect(classifyLinkError(new ApiError(403, 'WRONG_LINK_ACTION', ''))).toBe('wrongAction');
    expect(classifyLinkError(new ApiError(409, 'CONFLICT', ''))).toBe('notAllowed');
    expect(classifyLinkError(new ApiError(0, 'NETWORK', ''))).toBe('network');
    expect(classifyLinkError(new ApiError(500, 'INTERNAL', ''))).toBe('generic');
    expect(classifyLinkError(new Error('x'))).toBe('generic');
  });
});

describe('links API client', () => {
  afterEach(() => vi.unstubAllGlobals());
  const mock = (status: number, body: unknown) => {
    const fn = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  it('GET sends no body and parses the contract', async () => {
    const fn = mock(200, link({ act: 'confirm' }));
    await expect(getLink('tok/1')).resolves.toMatchObject({ act: 'confirm' });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('/api/links/tok%2F1');
    expect(init!.method).toBe('GET');
    expect(init!.body).toBeUndefined();
  });

  it('POST sends only the action', async () => {
    const fn = mock(200, { ...link(), result: 'confirmed' });
    await expect(postLinkAction('tok', 'confirm')).resolves.toMatchObject({ result: 'confirmed' });
    expect(JSON.parse(fn.mock.calls[0]![1]!.body as string)).toEqual({ action: 'confirm' });
  });

  it('surfaces 410 and a malformed answer as errors', async () => {
    mock(410, { error: { code: 'LINK_EXPIRED', message: 'x', fields: {} } });
    await expect(getLink('tok')).rejects.toMatchObject({ status: 410, code: 'LINK_EXPIRED' });
    mock(200, { act: 'confirm' });
    await expect(getLink('tok')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });
});

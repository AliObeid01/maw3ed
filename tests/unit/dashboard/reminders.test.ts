import { describe, expect, it } from 'vitest';
import type { ReminderItem } from '@/lib/api/reminders';
import {
  deriveReminder,
  idleMark,
  markReducer,
  pendingCount,
  sortReminders,
  type LocalMark,
} from '@/lib/reminders/state';

const item = (id: string, extra: Partial<ReminderItem> = {}): ReminderItem => ({
  id,
  kind: 'H24',
  dueAt: '2026-10-29T07:00:00Z',
  appointment: {
    id: `a-${id}`,
    startAt: '2026-10-30T07:00:00Z',
    service: { id: 's1', name: 'Haircut' },
    staff: { id: 'p1', displayName: 'Lina' },
  },
  client: { name: 'Maya', phone: '+96170555218', noShows: 0 },
  whatsappUrl: 'https://wa.me/96170555218?text=hi',
  phoneInvalid: false,
  status: 'PENDING',
  sentBy: null,
  sentAt: null,
  ...extra,
});

describe('deriveReminder', () => {
  it('pending item with a link can be sent', () => {
    expect(deriveReminder(item('1'))).toEqual({ kind: 'pending' });
  });
  it('SENT items show who sent them', () => {
    const sent = item('1', {
      status: 'SENT',
      sentBy: { id: 'u1', name: 'Rana' },
      sentAt: '2026-10-29T07:14:00Z',
    });
    expect(deriveReminder(sent)).toEqual({
      kind: 'sent',
      by: { id: 'u1', name: 'Rana' },
      at: '2026-10-29T07:14:00Z',
      fromOthers: true,
    });
  });
  it('no usable phone: phoneInvalid or a null link', () => {
    expect(deriveReminder(item('1', { phoneInvalid: true }))).toEqual({ kind: 'noPhone' });
    expect(deriveReminder(item('1', { whatsappUrl: null }))).toEqual({ kind: 'noPhone' });
  });
  it('a SENT item with an invalid phone is still just sent', () => {
    const sent = item('1', { status: 'SENT', phoneInvalid: true, whatsappUrl: null });
    expect(deriveReminder(sent).kind).toBe('sent');
  });
  it('local marks win over the server state', () => {
    expect(deriveReminder(item('1'), { phase: 'marking' })).toEqual({ kind: 'sending' });
    expect(deriveReminder(item('1'), { phase: 'retry' })).toEqual({ kind: 'retry' });
    expect(deriveReminder(item('1'), { phase: 'sent', by: null, at: 'x' })).toMatchObject({
      kind: 'sent',
      fromOthers: false,
    });
  });
});

describe('markReducer', () => {
  const run = (events: Parameters<typeof markReducer>[1][]) =>
    events.reduce<LocalMark>(markReducer, idleMark);
  const rana = { id: 'u1', name: 'Rana' };

  it('tap -> ok ends sent', () => {
    expect(run([{ type: 'tap' }, { type: 'ok', by: rana, at: 't' }])).toEqual({
      phase: 'sent',
      by: rana,
      at: 't',
    });
  });
  it('409 means someone else sent it', () => {
    expect(run([{ type: 'tap' }, { type: 'conflict', by: rana, at: 't' }])).toEqual({
      phase: 'alreadySent',
      by: rana,
      at: 't',
    });
  });
  it('failure goes to retry; retry re-marks without a new tap needing WhatsApp', () => {
    const failed = run([{ type: 'tap' }, { type: 'fail' }]);
    expect(failed).toEqual({ phase: 'retry' });
    expect(markReducer(failed, { type: 'retry' })).toEqual({ phase: 'marking' });
    expect(markReducer(failed, { type: 'conflict', by: rana, at: 't' }).phase).toBe('alreadySent');
  });
  it('a second tap while marking or sent is ignored (no double send)', () => {
    expect(run([{ type: 'tap' }, { type: 'tap' }])).toEqual({ phase: 'marking' });
    const sent = run([{ type: 'tap' }, { type: 'ok', by: rana, at: 't' }, { type: 'tap' }]);
    expect(sent.phase).toBe('sent');
  });
  it('late events from a stale request do nothing', () => {
    expect(markReducer(idleMark, { type: 'ok', by: rana, at: 't' })).toEqual(idleMark);
    expect(markReducer(idleMark, { type: 'fail' })).toEqual(idleMark);
  });
});

describe('list helpers', () => {
  it('pendingCount excludes sent and in-flight rows but keeps retry and noPhone', () => {
    const items = [
      item('1'),
      item('2', { status: 'SENT', sentBy: null }),
      item('3'),
      item('4', { phoneInvalid: true }),
      item('5'),
    ];
    expect(
      pendingCount(items, {
        '3': { phase: 'marking' },
        '5': { phase: 'retry' },
      }),
    ).toBe(3);
  });
  it('sortReminders puts pending first, then by appointment time', () => {
    const later = item('late', {
      appointment: { ...item('x').appointment, startAt: '2026-10-31T07:00:00Z' },
    });
    const sent = item('sent', { status: 'SENT' });
    const soon = item('soon');
    expect(sortReminders([sent, later, soon]).map((i) => i.id)).toEqual(['soon', 'late', 'sent']);
  });
});

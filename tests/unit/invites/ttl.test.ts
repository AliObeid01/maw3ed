import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import ar from '../../../messages/ar.json';
import { INVITE_TTL_DAYS, INVITE_TTL_MS } from '@/lib/invites/ttl';
import { INVITE_TTL_MS as SERVICE_TTL_MS } from '@/server/services/invites';

type Messages = typeof en;
const hint = (m: Messages) => m.app.staff.invite.hint;
const render = (locale: 'en' | 'ar', messages: Messages, days: number) =>
  createTranslator({ locale, messages, namespace: 'app.staff.invite' })('hint', { days });

describe('invite lifetime text cannot drift from the constant', () => {
  it('the service uses the shared constant and it is whole days', () => {
    expect(SERVICE_TTL_MS).toBe(INVITE_TTL_MS);
    expect(INVITE_TTL_MS).toBe(INVITE_TTL_DAYS * 24 * 3600 * 1000);
    expect(Number.isInteger(INVITE_TTL_DAYS)).toBe(true);
  });

  it('both locales take only {days} and hard-code no digits', () => {
    for (const m of [en, ar as Messages]) {
      const names = new Set([...hint(m).matchAll(/\{(\w+)/g)].map((x) => x[1]));
      expect(names).toEqual(new Set(['days']));
      expect(hint(m)).not.toMatch(/\d/);
    }
  });

  it('renders the real number of days with correct plurals', () => {
    expect(render('en', en, INVITE_TTL_DAYS)).toBe(`The link expires in ${INVITE_TTL_DAYS} days.`);
    expect(render('en', en, 1)).toBe('The link expires in 1 day.');
    expect(render('ar', ar as Messages, INVITE_TTL_DAYS)).toContain(String(INVITE_TTL_DAYS));
    expect(render('ar', ar as Messages, 2)).toContain('يومين');
    expect(render('ar', ar as Messages, 11)).toContain('11 يومًا');
  });

  it('no other invite message hard-codes a number of days or hours', () => {
    const text = JSON.stringify([en.app.staff, en.team.invite, en.auth.invite, en.email.invite, ar.app.staff, ar.team.invite, ar.auth.invite, ar.email.invite]);
    expect(text).not.toMatch(/\b\d+\s*(days|hours)|\d+\s*(أيام|يوم|ساعة)/);
  });
});

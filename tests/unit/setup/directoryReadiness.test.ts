import { describe, expect, it } from 'vitest';
import { directoryChecklist, missingFromError } from '@/lib/directory/readiness';

describe('directoryChecklist', () => {
  it('maps the setup flags to the three readiness items with a link to fix each', () => {
    const items = directoryChecklist({ hasServices: true, hasBookableStaff: false, hasHours: false });
    expect(items).toEqual([
      { id: 'services', done: true, href: '/app/services' },
      { id: 'staff', done: false, href: '/app/staff' },
      { id: 'hours', done: false, href: '/app/hours' },
    ]);
  });
});

describe('missingFromError', () => {
  it('reads the missing list of a NOT_READY conflict and drops unknown items', () => {
    expect(
      missingFromError({ code: 'NOT_READY', data: { missing: ['services', 'hours', 'x'] } }),
    ).toEqual(['services', 'hours']);
  });

  it('is empty for other errors or a malformed body', () => {
    expect(missingFromError({ code: 'SERVER' , data: { missing: ['services'] } })).toEqual([]);
    expect(missingFromError({ code: 'NOT_READY' })).toEqual([]);
    expect(missingFromError({ code: 'NOT_READY', data: { missing: 'services' } })).toEqual([]);
  });
});

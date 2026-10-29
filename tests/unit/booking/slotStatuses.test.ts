import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SLOT_HOLDING_STATUSES } from '@/server/domain/slotStatuses';

describe('slot-holding statuses', () => {
  it('match the appointment_no_overlap predicate in the migration', () => {
    const sql = readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../../prisma/migrations/20261028205918_appointment_no_overlap/migration.sql',
      ),
      'utf8',
    );
    const m = /appointment_no_overlap[\s\S]*?WHERE \(status IN \(([^)]*)\)\)/.exec(sql);
    expect(m).not.toBeNull();
    const inSql = [...m![1]!.matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual([...SLOT_HOLDING_STATUSES].sort());
  });
});

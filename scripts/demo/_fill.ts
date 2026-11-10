import { DateTime } from 'luxon';
import { buildPlan, ZONE } from './plan';

const now = new Date(process.argv[2] ?? '2026-11-10T09:30:00Z');
const nowMs = now.getTime();
const plan = buildPlan({
  now,
  owner: { email: 'demo-owner@demo.invalid', name: 'Demo Owner', passwordHash: 'x' },
  placeholderHash: 'y',
  only: ['cedar-smile-dental-clinic'],
});
const f = plan.businesses[0]!;
const byDay: Record<string, { filled: number; cap: number }> = {};
const days = new Set<string>();
for (const a of f.appointments) days.add(DateTime.fromJSDate(a.startAt, { zone: ZONE }).toISODate()!);
const todayStart = DateTime.fromMillis(nowMs, { zone: ZONE }).startOf('day').toMillis();
for (const day of [...days].sort()) {
  const d = DateTime.fromISO(day, { zone: ZONE });
  if (d.toMillis() >= todayStart) continue;
  const wd = d.weekday % 7;
  let cap = 0;
  for (const w of f.workingHours.filter((x) => x.weekday === wd)) {
    const [h1, m1] = w.startLocal.split(':').map(Number);
    const [h2, m2] = w.endLocal.split(':').map(Number);
    cap += h2! * 60 + m2! - (h1! * 60 + m1!);
  }
  let filled = 0;
  for (const a of f.appointments)
    if (
      !['CANCELLED', 'LATE_CANCEL'].includes(a.status) &&
      DateTime.fromJSDate(a.startAt, { zone: ZONE }).toISODate() === day
    )
      filled += (a.blockedUntil.getTime() - a.startAt.getTime()) / 60000;
  byDay[day] = { filled, cap };
}
const entries = Object.entries(byDay);
const fillOf = (pred: (d: string) => boolean) => {
  const sel = entries.filter(([d]) => pred(d));
  return (
    (sel.reduce((s, [, v]) => s + v.filled, 0) / sel.reduce((s, [, v]) => s + v.cap, 0)) *
    100
  ).toFixed(0);
};
console.log(
  'weekday fill %',
  fillOf((d) => DateTime.fromISO(d).weekday <= 5),
  'saturday',
  fillOf((d) => DateTime.fromISO(d).weekday === 6),
);
console.log('appointments', f.appointments.length);

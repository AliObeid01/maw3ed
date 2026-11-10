import { DateTime } from 'luxon';
import { buildPlan, summarizePlan, ZONE } from './plan';

const now = new Date(process.argv[2] ?? '2026-11-10T09:30:00Z');
const t0 = Date.now();
const plan = buildPlan({
  now,
  owner: { email: 'demo-owner@demo.invalid', name: 'Demo Owner', passwordHash: 'x' },
  placeholderHash: 'y',
});
console.log('built ms', Date.now() - t0);
const s = summarizePlan(plan);
console.log(JSON.stringify(s.total), JSON.stringify(s.byStatus));
console.log(JSON.stringify(s.jobs));
const f = plan.businesses.find((b) => b.spec.flagship)!;
const nowMs = now.getTime();
const week = (d: Date) =>
  Math.round(
    (DateTime.fromJSDate(d, { zone: ZONE }).startOf('week').toMillis() -
      DateTime.fromMillis(nowMs, { zone: ZONE }).startOf('week').toMillis()) /
      (7 * 86400000),
  );
const wk: Record<number, { a: number; n: number; l: number; c: number }> = {};
let att = 0,
  ns = 0,
  conf = 0,
  rem = 0;
for (const a of f.appointments) {
  if (a.startAt.getTime() >= nowMs) continue;
  const w = week(a.startAt);
  wk[w] ??= { a: 0, n: 0, l: 0, c: 0 };
  if (a.status === 'ATTENDED') (wk[w]!.a++, att++);
  if (a.status === 'NO_SHOW') (wk[w]!.n++, ns++);
  if (a.status === 'LATE_CANCEL') wk[w]!.l++;
  if (a.status === 'CANCELLED') wk[w]!.c++;
}
for (const [k, v] of Object.entries(wk))
  console.log(k, JSON.stringify(v), ((v.n / (v.a + v.n)) * 100).toFixed(1) + '%');
console.log('overall', ((ns / (att + ns)) * 100).toFixed(1) + '%', att, ns);
const sentJobs = new Set(f.reminderJobs.filter((j) => j.status === 'SENT' && (j.kind === 'H24' || j.kind === 'H2')).map((j) => j.appointmentId));
for (const a of f.appointments) {
  if (a.startAt.getTime() >= nowMs || ['CANCELLED', 'LATE_CANCEL'].includes(a.status)) continue;
  if (!sentJobs.has(a.id)) continue;
  rem++;
  if (a.confirmedAt) conf++;
}
console.log('confirm', ((conf / rem) * 100).toFixed(1) + '%', conf, rem);
console.log('offers', f.waitlistOffers.length, f.waitlistOffers.filter((o) => o.status === 'CLAIMED').length);
console.log('flaky', f.clients.filter((c) => c.noShows >= 2).map((c) => c.noShows).join(','));
console.log('open waitlist', f.waitlistEntries.filter((e) => e.status === 'OPEN').length);
const unmarked = f.appointments.filter((a) => a.endAt.getTime() <= nowMs && ['BOOKED', 'CONFIRMED'].includes(a.status));
console.log('unmarked', unmarked.length);
console.log('future', f.appointments.filter((a) => a.startAt.getTime() > nowMs).length);
const pastCount = (b: typeof f) => b.appointments.filter((a) => a.startAt.getTime() < nowMs).length;
console.log(plan.businesses.map((b) => `${b.spec.slug}:${b.appointments.length}/${pastCount(b)}/${b.clients.length}`).join('\n'));

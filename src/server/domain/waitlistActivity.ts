export type ActivityType = 'OFFERED' | 'CLAIMED' | 'EXPIRED';

export interface ActivityOffer {
  id: string;
  status: 'OPEN' | 'CLAIMED' | 'EXPIRED' | 'SUPERSEDED';
  startAt: Date;
  expiresAt: Date;
  createdAt: Date;
  freedFromAppointmentId: string;
  claimedAt: Date | null;
  service: { id: string; name: string };
  staff: { id: string; displayName: string };
  clientName: string;
}

export interface ActivityItem {
  type: ActivityType;
  at: Date;
  offerId: string;
  slot: {
    startAt: Date;
    service: { id: string; name: string };
    staff: { id: string; displayName: string };
  };
  offeredTo: number;
  /** First name only (privacy). */
  claimedBy: { name: string } | null;
}

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? '';

/**
 * One item per freed slot: "offered to 3 people", "Rami took 15:00 with Karim", or "nobody claimed".
 * Pure; newest first.
 */
export function summarizeActivity(offers: ActivityOffer[], limit: number): ActivityItem[] {
  const bySlot = new Map<string, ActivityOffer[]>();
  for (const o of offers) {
    const list = bySlot.get(o.freedFromAppointmentId);
    if (list) list.push(o);
    else bySlot.set(o.freedFromAppointmentId, [o]);
  }
  const maxOf = (dates: Date[]) => new Date(Math.max(...dates.map((d) => d.getTime())));
  const items: ActivityItem[] = [];
  for (const group of bySlot.values()) {
    const claimed = group.find((o) => o.status === 'CLAIMED');
    const first = group[0]!;
    let type: ActivityType;
    let at: Date;
    if (claimed) {
      type = 'CLAIMED';
      at = claimed.claimedAt ?? claimed.createdAt;
    } else if (group.some((o) => o.status === 'OPEN')) {
      type = 'OFFERED';
      at = maxOf(group.map((o) => o.createdAt));
    } else {
      type = 'EXPIRED';
      at = maxOf(group.map((o) => o.expiresAt));
    }
    items.push({
      type,
      at,
      offerId: (claimed ?? first).id,
      slot: { startAt: first.startAt, service: first.service, staff: first.staff },
      offeredTo: group.length,
      claimedBy: claimed ? { name: firstName(claimed.clientName) } : null,
    });
  }
  return items
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.offerId < b.offerId ? -1 : 1))
    .slice(0, limit);
}

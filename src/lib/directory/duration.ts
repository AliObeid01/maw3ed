export type DurationParts =
  | { kind: 'min'; count: number }
  | { kind: 'h'; count: number }
  | { kind: 'hMin'; hours: number; minutes: number };

/** A service length split for the messages: 30 -> "30 min", 60 -> "1 h", 90 -> "1 h 30". Pure. */
export function durationParts(durationMin: number): DurationParts {
  const total = Math.max(0, Math.round(durationMin));
  if (total < 60) return { kind: 'min', count: total };
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? { kind: 'h', count: hours } : { kind: 'hMin', hours, minutes };
}

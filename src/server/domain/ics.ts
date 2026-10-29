export interface IcsEvent {
  /** `<appointment id>@maw3ed` */
  uid: string;
  startAt: Date;
  endAt: Date;
  /** DTSTAMP: injected so the output is deterministic. */
  stamp: Date;
  summary: string;
  description?: string | undefined;
  location?: string | undefined;
}

/** RFC 5545 section 3.3.11 TEXT escaping. Newlines of any kind become the two characters `\n`. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** `20261104T070000Z` */
export function icsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

/** Fold to at most 75 octets per line (continuation lines start with one space), never inside a character. */
export function foldIcsLine(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let limit = 75;
  for (const ch of line) {
    if (Buffer.byteLength(current) + Buffer.byteLength(ch) > limit) {
      parts.push(current);
      current = '';
      limit = 74; // the leading space of a continuation line counts
    }
    current += ch;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** A single-event calendar file: UTC times, CRLF line endings, escaped text. Pure. */
export function buildIcs(event: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Maw3ed//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${icsUtc(event.stamp)}`,
    `DTSTART:${icsUtc(event.startAt)}`,
    `DTEND:${icsUtc(event.endAt)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    ...(event.description ? [`DESCRIPTION:${escapeIcsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeIcsText(event.location)}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

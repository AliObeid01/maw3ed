import { describe, expect, it } from 'vitest';
import { buildIcs, escapeIcsText, foldIcsLine } from '@/server/domain/ics';

const base = {
  uid: 'appt123@maw3ed',
  startAt: new Date('2026-11-04T07:00:00Z'),
  endAt: new Date('2026-11-04T07:30:00Z'),
  stamp: new Date('2026-11-02T08:00:00Z'),
  summary: 'Haircut at Studio Nour',
};

describe('ics', () => {
  it('builds a CRLF-terminated VCALENDAR with UTC times and the appointment UID', () => {
    const ics = buildIcs(base);
    const lines = ics.split('\r\n');
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('METHOD:PUBLISH');
    expect(lines).toContain('BEGIN:VEVENT');
    expect(lines).toContain('UID:appt123@maw3ed');
    expect(lines).toContain('DTSTAMP:20261102T080000Z');
    expect(lines).toContain('DTSTART:20261104T070000Z');
    expect(lines).toContain('DTEND:20261104T073000Z');
    expect(lines).toContain('SUMMARY:Haircut at Studio Nour');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('escapes backslash, semicolon, comma and newlines in text values', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
    const ics = buildIcs({ ...base, summary: 'Cut; trim, "style"', location: 'Main St\nBeirut' });
    expect(ics).toContain('SUMMARY:Cut\\; trim\\, "style"\r\n');
    expect(ics).toContain('LOCATION:Main St\\nBeirut\r\n');
  });

  it('cannot be injected into via a newline in a dynamic value', () => {
    const ics = buildIcs({ ...base, summary: 'x\r\nATTENDEE:mailto:evil@example.test' });
    expect(ics.split('\r\n')).not.toContain('ATTENDEE:mailto:evil@example.test');
  });

  it('folds lines longer than 75 octets with CRLF + space', () => {
    const folded = foldIcsLine(`SUMMARY:${'a'.repeat(200)}`);
    for (const part of folded.split('\r\n'))
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((p) => p.startsWith(' ')),
    ).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'a'.repeat(200)}`);
  });

  it('never splits a multi-byte character when folding', () => {
    const text = `SUMMARY:${'موعد'.repeat(40)}`;
    const folded = foldIcsLine(text);
    expect(folded.replace(/\r\n /g, '')).toBe(text);
    for (const part of folded.split('\r\n'))
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
  });
});

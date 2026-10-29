import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, toCsv } from '@/server/domain/csv';

describe('csvCell', () => {
  it('leaves plain text alone and renders null as empty', () => {
    expect(csvCell('Haircut')).toBe('Haircut');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(3)).toBe('3');
  });
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell('l1\r\nl2')).toBe('"l1\r\nl2"');
  });
  it('leaves a valid E.164 phone number alone (8 to 15 digits) but not a short or spaced one', () => {
    expect(csvCell('+96171123456')).toBe('+96171123456');
    expect(csvCell('+12345678')).toBe('+12345678');
    expect(csvCell('+1234567')).toBe("'+1234567");
    expect(csvCell(' +96171123456')).toBe("' +96171123456");
  });
  it.each([
    '=1+1',
    '+9617',
    '-5',
    '@SUM(A1)',
    '\tx',
    '\rx',
    ' =1+1',
    '  @SUM(A1)',
    '\n=1+1',
    '\u0001+cmd',
    ' \t -2',
  ])('prefixes %j with a quote', (v) => {
    expect(csvCell(v).startsWith("'") || csvCell(v).startsWith('"\'')).toBe(true);
  });
  it('does not prefix a formula character in the middle', () => {
    expect(csvCell('a=b')).toBe('a=b');
  });
  it('neutralises then quotes a formula that also needs quoting', () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });
  it('keeps Arabic text intact', () => {
    expect(csvCell('سارة')).toBe('سارة');
    expect(csvCell('سارة، المحترفة')).toBe('سارة، المحترفة'); // the Arabic comma is not a delimiter
    expect(csvCell('سارة, المحترفة')).toBe('"سارة, المحترفة"');
  });
});

describe('toCsv', () => {
  it('starts with a BOM, uses CRLF and ends with CRLF', () => {
    const out = toCsv(['a', 'b'], [['1', 'x,y']]);
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out).toBe(`${CSV_BOM}a,b\r\n1,"x,y"\r\n`);
  });
  it('header only when there are no rows', () => {
    expect(toCsv(['a'], [])).toBe(`${CSV_BOM}a\r\n`);
  });
});

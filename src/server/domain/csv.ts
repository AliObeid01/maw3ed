/** RFC 4180 CSV with spreadsheet-formula injection protection. Pure. */

export const CSV_BOM = '﻿';

/**
 * A cell is dangerous when, after leading whitespace / control characters (spreadsheets trim them, a leading
 * newline included), it starts with = + - @; a leading tab or CR is dangerous on its own.
 */
const FORMULA_START = /^(?:[\t\r]|[\s\u0000-\u001f]*[=+\-@])/;
/** A plain international phone number is left as is: an apostrophe in a phone column is worse than the risk. */
const E164 = /^\+\d{8,15}$/;

/**
 * Neutralise cells that Excel / Sheets would evaluate: prefix a single quote. Valid E.164 numbers are the one
 * exception (spreadsheet apps may still reformat them, e.g. drop the plus sign; documented, not prevented).
 */
export function neutralise(value: string): string {
  return FORMULA_START.test(value) && !E164.test(value) ? `'${value}` : value;
}

/** One cell: injection-safe, and quoted when it holds a comma, quote, CR or LF. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = neutralise(String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvRow = (cells: ReadonlyArray<string | number | null | undefined>): string =>
  cells.map(csvCell).join(',');

/** Header + rows, CRLF separated, trailing CRLF, UTF-8 BOM first so Excel reads Arabic correctly. */
export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return CSV_BOM + [csvRow(header), ...rows.map(csvRow)].join('\r\n') + '\r\n';
}

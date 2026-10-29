/** RFC 4180 CSV with spreadsheet-formula injection protection. Pure. */

export const CSV_BOM = '﻿';

const FORMULA_START = /^[=+\-@\t\r]/;

/** Neutralise cells that Excel / Sheets would evaluate: prefix a single quote. */
export function neutralise(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
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

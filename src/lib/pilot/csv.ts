import { API_BASE, ApiError, parseErrorBody } from '@/lib/api/auth';
import { addDays } from '@/lib/pilot/viewModel';

/** File name from a Content-Disposition header, or `fallback`. Only a plain, safe name is accepted. */
export function filenameFrom(header: string | null, fallback: string): string {
  const match = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  const name = match?.[1]?.trim();
  return name && /^[\w.-]+$/.test(name) ? name : fallback;
}

/** The server exports at most 366 local days (inclusive). */
export const MAX_EXPORT_DAYS = 366;

/** `from` moved up to `to - 365 days` when the range is longer than the server allows. */
export function clampExportRange(from: string, to: string): { from: string; to: string; clamped: boolean } {
  const earliest = addDays(to, -(MAX_EXPORT_DAYS - 1));
  return from < earliest ? { from: earliest, to, clamped: true } : { from, to, clamped: false };
}

export const csvPath =(from: string, to: string) =>
  `/api/pilot/export.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/**
 * Downloads the CSV through the authenticated endpoint (same-origin cookie). Errors become ApiError exactly like
 * every other request, so a 401/403 is handled by the usual error message.
 */
export async function fetchCsv(
  from: string,
  to: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetchImpl(`${API_BASE}${csvPath(from, to)}`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    throw parseErrorBody(res.status, body);
  }
  return {
    blob: await res.blob(),
    filename: filenameFrom(res.headers.get('content-disposition'), `maw3ed-pilot-${from}-${to}.csv`),
  };
}

/** Hands a blob to the browser as a download (browser only). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

import { describe, expect, it, vi } from 'vitest';
import { clampExportRange, csvPath, fetchCsv, filenameFrom } from '@/lib/pilot/csv';

describe('filenameFrom', () => {
  it('reads a quoted or bare name', () => {
    expect(filenameFrom('attachment; filename="maw3ed-pilot.csv"', 'x.csv')).toBe('maw3ed-pilot.csv');
    expect(filenameFrom('attachment; filename=a_b-1.csv', 'x.csv')).toBe('a_b-1.csv');
  });
  it('falls back for a missing header or an unsafe name', () => {
    expect(filenameFrom(null, 'x.csv')).toBe('x.csv');
    expect(filenameFrom('attachment; filename="../../etc/passwd"', 'x.csv')).toBe('x.csv');
  });
});

describe('clampExportRange', () => {
  it('keeps a range of up to 366 days and clamps a longer one to to - 365 days', () => {
    expect(clampExportRange('2025-10-29', '2026-10-29')).toEqual({ from: '2025-10-29', to: '2026-10-29', clamped: false });
    // 366 days inclusive: 2025-10-29 .. 2026-10-29 is 366 days, one day earlier is 367.
    expect(clampExportRange('2025-10-28', '2026-10-29')).toEqual({ from: '2025-10-29', to: '2026-10-29', clamped: true });
    expect(clampExportRange('2020-01-01', '2026-10-29').from).toBe('2025-10-29');
    expect(clampExportRange('2026-10-01', '2026-10-29').clamped).toBe(false);
  });
});

describe('fetchCsv', () => {
  it('requests the range with the session cookie and returns the blob and name', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response('a,b\n1,2\n', {
        status: 200,
        headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="p.csv"' },
      }),
    );
    const { blob, filename } = await fetchCsv('2026-10-15', '2026-10-28', f as unknown as typeof fetch);
    expect(f.mock.calls[0]![0]).toBe(csvPath('2026-10-15', '2026-10-28'));
    expect(f.mock.calls[0]![0]).toBe('/api/pilot/export.csv?from=2026-10-15&to=2026-10-28');
    expect(f.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin' });
    expect(filename).toBe('p.csv');
    expect(await blob.text()).toBe('a,b\n1,2\n');
  });
  it('builds a default file name', async () => {
    const f = vi.fn().mockResolvedValue(new Response('x', { status: 200 }));
    expect((await fetchCsv('2026-10-15', '2026-10-28', f as unknown as typeof fetch)).filename).toBe(
      'maw3ed-pilot-2026-10-15-2026-10-28.csv',
    );
  });
  it('turns a 403 into an ApiError and a network failure into NETWORK', async () => {
    const denied = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'no' } }), { status: 403 }));
    await expect(fetchCsv('a', 'b', denied as unknown as typeof fetch)).rejects.toMatchObject({ status: 403 });
    const down = vi.fn().mockRejectedValue(new TypeError('x'));
    await expect(fetchCsv('a', 'b', down as unknown as typeof fetch)).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

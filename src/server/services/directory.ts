import type { DirectoryQueryT } from '@/server/contracts/directory';
import { AppError } from '@/server/http/errors';
import { directoryRepo } from '@/server/repositories/directory.repo';

const encodeCursor = (name: string, id: string) =>
  Buffer.from(JSON.stringify([name, id]), 'utf8').toString('base64url');

function decodeCursor(cursor: string): { name: string; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    )
      return { name: parsed[0], id: parsed[1] };
  } catch {
    /* fall through */
  }
  throw AppError.validation({ cursor: 'Invalid cursor.' });
}

export const directoryService = {
  /** Public. Only listed businesses that still meet readiness; no owner, staff or client data. */
  async list(query: DirectoryQueryT) {
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await directoryRepo.list({
      search: query.search,
      category: query.category,
      after,
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    return {
      businesses: page.map(({ id: _id, ...b }) => b),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.name, last.id) : null,
    };
  },
};

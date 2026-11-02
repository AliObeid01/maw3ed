type FsLike = Record<string, (...args: never[]) => unknown>;
export function cleanSourceMaps(
  distDir?: string,
  fsApi?: unknown,
): { deleted: number; stripped: number; skipped: number };
export function findPublicSourceMapLeaks(distDir?: string, fsApi?: unknown): string[];
export type { FsLike };

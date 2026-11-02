// Runs after `next build` (package.json "build" and scripts/vercel-build.mjs): no source map is left in the
// deployment and no public asset points at one. See scripts/lib/cleanSourcemaps.mjs.
// A sweep problem never fails a good build: a leak is a warning (count and first paths, never contents). Only
// when CI=true and VERCEL is unset (GitHub Actions, local CI) does a leak exit 1, so it is caught before merge
// while a Vercel deploy never fails. Any unexpected error exits 0.
import { cleanSourceMaps, findPublicSourceMapLeaks } from './lib/cleanSourcemaps.mjs';

let leaks = [];
try {
  const { deleted, stripped, skipped } = cleanSourceMaps('.next');
  if (deleted > 0 || stripped > 0) {
    console.log(`Source maps: removed ${deleted} map file(s) and ${stripped} sourceMappingURL comment(s) from the build output.`);
  }
  if (skipped > 0) console.warn(`Warning: ${skipped} build file(s) could not be cleaned (skipped).`);
  leaks = findPublicSourceMapLeaks('.next');
  if (leaks.length > 0) {
    console.warn(`Warning: ${leaks.length} public build file(s) still reference or contain a source map. First: ${leaks.slice(0, 3).join(', ')}`);
  }
} catch (error) {
  console.warn(`Warning: source map sweep failed (${error instanceof Error ? error.name : 'error'}); the build output is unchanged.`);
}
process.exit(leaks.length > 0 && process.env.CI === 'true' && !process.env.VERCEL ? 1 : 0);

// Runs after `next build` (package.json "build" and scripts/vercel-build.mjs): no source map is left in the
// deployment and no public asset points at one. See scripts/lib/cleanSourcemaps.mjs.
import { cleanSourceMaps, findPublicSourceMapLeaks } from './lib/cleanSourcemaps.mjs';

const { deleted, stripped } = cleanSourceMaps('.next');
if (deleted > 0 || stripped > 0) {
  console.log(`Source maps: removed ${deleted} map file(s) and ${stripped} sourceMappingURL comment(s) from the build output.`);
}
const leaks = findPublicSourceMapLeaks('.next');
if (leaks.length > 0) console.warn(`Warning: ${leaks.length} public build file(s) still reference or contain a source map.`);

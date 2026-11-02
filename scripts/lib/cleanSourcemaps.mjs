// Last line of defence for F39: whatever the Sentry plugin did or did not do (failed upload, partial delete), the
// deployment must never serve a source map or a comment pointing at one. Removes every `*.map` under
// `.next/static` (public) and `.next/server`, and strips `sourceMappingURL` comments from the public assets.
// Best effort: it never throws (every file operation is guarded; unreadable files are counted and skipped).
// `fsApi` is injectable for tests.
import nodeFs from 'node:fs';
import path from 'node:path';

const COMMENT_JS = /(?:\r?\n)?\/\/[#@]\s*sourceMappingURL=[^\r\n]*\s*$/;
const COMMENT_CSS = /(?:\r?\n)?\/\*[#@]\s*sourceMappingURL=[^*]*\*\/\s*$/;
const ASSET = /\.(?:js|mjs|cjs|css)$/;

function* walk(dir, fsApi) {
  let entries;
  try {
    entries = fsApi.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, fsApi);
    else if (entry.isFile()) yield full;
  }
}

/** @returns {{ deleted: number, stripped: number, skipped: number }} skipped = files that could not be handled. */
export function cleanSourceMaps(distDir = '.next', fsApi = nodeFs) {
  let deleted = 0;
  let stripped = 0;
  let skipped = 0;
  try {
    for (const file of walk(path.join(distDir, 'server'), fsApi)) {
      if (!file.endsWith('.map')) continue;
      try {
        fsApi.rmSync(file, { force: true });
        deleted++;
      } catch {
        skipped++;
      }
    }
    for (const file of walk(path.join(distDir, 'static'), fsApi)) {
      try {
        if (file.endsWith('.map')) {
          fsApi.rmSync(file, { force: true });
          deleted++;
        } else if (ASSET.test(file)) {
          const text = fsApi.readFileSync(file, 'utf8');
          if (!text.includes('sourceMappingURL=')) continue;
          const next = text.replace(COMMENT_JS, '').replace(COMMENT_CSS, '');
          if (next !== text) {
            fsApi.writeFileSync(file, next);
            stripped++;
          }
        }
      } catch {
        skipped++;
      }
    }
  } catch {
    skipped++;
  }
  return { deleted, stripped, skipped };
}

/** Public files that would still expose a map: a `*.map`, or `sourceMappingURL=` in an asset. Never throws. */
export function findPublicSourceMapLeaks(distDir = '.next', fsApi = nodeFs) {
  const leaks = [];
  try {
    for (const file of walk(path.join(distDir, 'static'), fsApi)) {
      try {
        if (file.endsWith('.map')) leaks.push(file);
        else if (ASSET.test(file) && fsApi.readFileSync(file, 'utf8').includes('sourceMappingURL=')) leaks.push(file);
      } catch {
        /* unreadable: skip */
      }
    }
  } catch {
    /* nothing to report */
  }
  return leaks;
}

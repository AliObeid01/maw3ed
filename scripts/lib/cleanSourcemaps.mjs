// Last line of defence for F39: whatever the Sentry plugin did or did not do (failed upload, partial delete), the
// deployment must never serve a source map or a comment pointing at one. Removes every `*.map` under
// `.next/static` (public) and `.next/server`, and strips `sourceMappingURL` comments from the public assets.
// Best effort and silent about values: it never throws.
import fs from 'node:fs';
import path from 'node:path';

const COMMENT_JS = /(?:\r?\n)?\/\/[#@]\s*sourceMappingURL=[^\r\n]*\s*$/;
const COMMENT_CSS = /(?:\r?\n)?\/\*[#@]\s*sourceMappingURL=[^*]*\*\/\s*$/;
const ASSET = /\.(?:js|mjs|cjs|css)$/;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** @returns {{ deleted: number, stripped: number }} */
export function cleanSourceMaps(distDir = '.next') {
  let deleted = 0;
  let stripped = 0;
  for (const file of walk(path.join(distDir, 'server'))) {
    if (file.endsWith('.map')) {
      try {
        fs.rmSync(file, { force: true });
        deleted++;
      } catch {
        /* keep going */
      }
    }
  }
  for (const file of walk(path.join(distDir, 'static'))) {
    try {
      if (file.endsWith('.map')) {
        fs.rmSync(file, { force: true });
        deleted++;
      } else if (ASSET.test(file)) {
        const text = fs.readFileSync(file, 'utf8');
        if (!text.includes('sourceMappingURL=')) continue;
        const next = text.replace(COMMENT_JS, '').replace(COMMENT_CSS, '');
        if (next !== text) {
          fs.writeFileSync(file, next);
          stripped++;
        }
      }
    } catch {
      /* keep going */
    }
  }
  return { deleted, stripped };
}

/** Files that would still expose a map: a `*.map`, or a `sourceMappingURL=` in a public asset. For verification. */
export function findPublicSourceMapLeaks(distDir = '.next') {
  const leaks = [];
  for (const file of walk(path.join(distDir, 'static'))) {
    if (file.endsWith('.map')) leaks.push(file);
    else if (ASSET.test(file) && fs.readFileSync(file, 'utf8').includes('sourceMappingURL=')) leaks.push(file);
  }
  return leaks;
}

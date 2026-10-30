#!/usr/bin/env node
// Fails (exit 1) when messages/en.json and messages/ar.json differ in:
//   - keys,
//   - the set of ICU argument names used by a key ({name}, {count, plural, ...}),
//   - plural/select blocks without an `other` branch (either language).
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'messages');

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, String(v));
  }
  return out;
}

function matching(str, open) {
  let depth = 0;
  for (let i = open; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Collects argument names and plural/select blocks that lack `other`. */
function analyse(str, names = new Set(), problems = []) {
  for (let i = 0; i < str.length; i++) {
    if (str[i] !== '{') continue;
    const end = matching(str, i);
    if (end < 0) {
      problems.push('unbalanced braces');
      break;
    }
    const inner = str.slice(i + 1, end);
    const parts = inner.split(',');
    names.add(parts[0].trim());
    const type = parts[1]?.trim();
    if (type === 'plural' || type === 'select' || type === 'selectordinal') {
      const rest = parts.slice(2).join(',');
      const selectors = [];
      for (let j = 0; j < rest.length; j++) {
        if (/\s/.test(rest[j])) continue;
        let k = j;
        while (k < rest.length && !/[\s{]/.test(rest[k])) k++;
        selectors.push(rest.slice(j, k));
        while (/\s/.test(rest[k] ?? '')) k++;
        if (rest[k] !== '{') break;
        const close = matching(rest, k);
        if (close < 0) break;
        analyse(rest.slice(k + 1, close), names, problems);
        j = close;
      }
      if (!selectors.includes('other')) problems.push(`${parts[0].trim()} ${type} has no "other" branch`);
    }
    i = end;
  }
  return { names, problems };
}

const load = (l) => flatten(JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8')));
const en = load('en');
const ar = load('ar');
const errors = [];

for (const k of en.keys()) if (!ar.has(k)) errors.push(`missing in ar: ${k}`);
for (const k of ar.keys()) if (!en.has(k)) errors.push(`missing in en: ${k}`);

for (const [k, enValue] of en) {
  const arValue = ar.get(k);
  if (arValue === undefined) continue;
  const e = analyse(enValue);
  const a = analyse(arValue);
  for (const p of e.problems) errors.push(`en ${k}: ${p}`);
  for (const p of a.problems) errors.push(`ar ${k}: ${p}`);
  const only = (x, y) => [...x].filter((n) => !y.has(n));
  const dropped = only(e.names, a.names);
  const added = only(a.names, e.names);
  if (dropped.length) errors.push(`ar ${k}: drops placeholder(s) ${dropped.join(', ')}`);
  if (added.length) errors.push(`ar ${k}: unknown placeholder(s) ${added.join(', ')}`);
}

if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`i18n keys match (${en.size} keys); placeholders and plurals consistent`);

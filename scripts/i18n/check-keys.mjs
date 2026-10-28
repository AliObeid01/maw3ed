#!/usr/bin/env node
// Fails (exit 1) when messages/en.json and messages/ar.json have different keys.
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? 'messages');

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

const load = (l) => flatten(JSON.parse(fs.readFileSync(path.join(dir, `${l}.json`), 'utf8')));
const en = load('en');
const ar = load('ar');
const missingInAr = [...en].filter((k) => !ar.has(k));
const missingInEn = [...ar].filter((k) => !en.has(k));

if (missingInAr.length || missingInEn.length) {
  for (const k of missingInAr) console.error(`missing in ar: ${k}`);
  for (const k of missingInEn) console.error(`missing in en: ${k}`);
  process.exit(1);
}
console.log(`i18n keys match (${en.size} keys)`);

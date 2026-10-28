#!/usr/bin/env node
// Unpacks maw3ed-design.html (a two-level __bundler bundle) into readable static markup,
// one file per design board: design/screens/<nn>-<slug>.html, plus design/screens/index.json.
// Usage: node scripts/design/extract-screens.mjs [path/to/maw3ed-design.html] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const src = process.argv[2] ?? 'maw3ed-design.html';
const outDir = process.argv[3] ?? 'design/screens';

function scriptTag(html, type) {
  const open = `<script type="__bundler/${type}">`;
  const start = html.indexOf(open);
  if (start < 0) return null;
  const end = html.indexOf('</script>', start);
  return html.slice(start + open.length, end).trim();
}

function unpack(html) {
  const manifest = scriptTag(html, 'manifest');
  const template = scriptTag(html, 'template');
  if (!manifest || !template) return { template: html, assets: {} };
  const assets = {};
  for (const [id, entry] of Object.entries(JSON.parse(manifest))) {
    let data = Buffer.from(entry.data, 'base64');
    if (entry.compressed) data = zlib.gunzipSync(data);
    assets[id] = { mime: entry.mime, data };
  }
  return { template: JSON.parse(template), assets };
}

function clean(html) {
  return html
    .replace(/\/\* [a-z-]+ \*\/\s*@font-face\s*\{[^}]*\}/g, '')
    .replace(/@font-face\s*\{[^}]*\}/g, '')
    .replace(/data:[a-z/+.\-0-9]+;base64,[A-Za-z0-9+/=]+/g, 'DATA')
    .replace(/<script src="[0-9a-f-]{36}"><\/script>\n?/g, '')
    .replace(/sc-camel-view-box=/g, 'viewBox=')
    .replace(/sc-camel-gradient-units=/g, 'gradientUnits=')
    .replace(/<style>\s*<\/style>\n?/g, '');
}

const slugify = (s) =>
  s.toLowerCase().replace(/&amp;/g, 'and').replace(/·\s*web/g, '').replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');

const top = unpack(fs.readFileSync(src, 'utf8'));
const boards = [...top.template.matchAll(/<h2>(.*?)<\/h2><iframe src="about:blank#([0-9a-f-]{36})"[^>]*width="(\d+)" height="(\d+)"/g)];
if (boards.length === 0) throw new Error(`No boards found in ${src}`);

fs.mkdirSync(outDir, { recursive: true });
const index = [];
boards.forEach(([, title, id, width, height], i) => {
  const page = top.assets[id];
  if (!page) throw new Error(`Missing asset ${id} for board "${title}"`);
  const inner = unpack(page.data.toString('utf8'));
  const file = `${String(i + 1).padStart(2, '0')}-${slugify(title)}.html`;
  const header = `<!-- Board: ${title.replace(/&amp;/g, '&')} · ${width}x${height} · source id ${id} -->\n`;
  fs.writeFileSync(path.join(outDir, file), header + clean(inner.template));
  index.push({ n: i + 1, title: title.replace(/&amp;/g, '&'), file, width: Number(width), height: Number(height), id });
});
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Extracted ${index.length} boards to ${outDir}`);

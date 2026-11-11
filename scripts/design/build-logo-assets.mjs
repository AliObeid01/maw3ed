// Regenerates every logo file from the owner's source (design/logo/maw3ed-logo-light.svg, PR-16b).
//   node scripts/design/build-logo-assets.mjs
// Writes the SVG variants into design/logo, the rasters (sharp) into design/logo, and copies the app and
// email files that ship into public/brand and src/app. Flat paths only: no fonts, gradients or images.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '../..');
const logoDir = path.join(root, 'design/logo');
const light = fs.readFileSync(path.join(logoDir, 'maw3ed-logo-light.svg'), 'utf8');

const NAVY = '#0B1938';
// Reverse variant on navy: the wordmark is white; the icon keeps its colours, and its navy body would vanish on a
// navy surface, so ONLY the reverse variant gets a slightly lighter body plus a faint light outline (same geometry).
const REV_BODY = '<rect y="6" width="64" height="58" rx="14" fill="#16295E" stroke="#FFFFFF" stroke-opacity=".22" stroke-width="1.2"/>';
const BODY = '<rect y="6" width="64" height="58" rx="14" fill="#0B1938"/>';
if (!light.includes(BODY) || !light.includes('<g fill="#0B1938">')) throw new Error('unexpected source logo');

const reverse = light.replace(BODY, REV_BODY).replace('<g fill="#0B1938">', '<g fill="#FFFFFF">');

// The 64 x 64 icon group (calendar-M) without the wordmark.
const iconInner = (body) => `${body}
<path d="M0 19V20A14 14 0 0 1 14 6H50A14 14 0 0 1 64 20V19Z" fill="#2864F5"/>
<rect x="17.5" y="0" width="5" height="13" rx="2.5" fill="#21CDB3"/><rect x="41.5" y="0" width="5" height="13" rx="2.5" fill="#21CDB3"/>
<g transform="translate(13.79 7.72) scale(0.53)">
<path fill="none" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" stroke="#FFFFFF" d="M6.5 93.5V34.5M62.5 34.5V93.5"/>
<path fill="none" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" stroke="#21CDB3" d="M6.5 34.5L34.5 76.98 62.5 34.5"/>
</g>`;
const svg = (viewBox, inner, name) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${name}"><title>${name}</title>\n${inner}\n</svg>\n`;
const iconLight = svg('0 0 64 64', iconInner(BODY), 'Maw3ed');
const iconReverse = svg('0 0 64 64', iconInner(REV_BODY), 'Maw3ed');

// Wordmark only (everything after the icon group), cropped to its artwork.
const wordStart = light.indexOf('<g fill="#0B1938">');
const wordBody = light.slice(wordStart, light.lastIndexOf('</svg>')).trim();
export const WORDMARK_VIEWBOX = '108 24 340 115';
const wordLight = svg(WORDMARK_VIEWBOX, wordBody, 'Maw3ed');
const wordReverse = svg(WORDMARK_VIEWBOX, wordBody.replace('<g fill="#0B1938">', '<g fill="#FFFFFF">'), 'Maw3ed');

const write = (rel, data) => {
  const file = path.join(logoDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};
write('maw3ed-logo-reverse.svg', reverse);
write('maw3ed-icon.svg', iconLight);
write('maw3ed-icon-reverse.svg', iconReverse);
write('maw3ed-wordmark-light.svg', wordLight);
write('maw3ed-wordmark-reverse.svg', wordReverse);

const raster = (input, width, height) =>
  sharp(Buffer.from(input), { density: Math.max(72, Math.ceil((width / 64) * 72 * 2)) })
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 });

// Full logo PNGs (1200 px wide) and the email header files (width x height keep the 469.53 : 141.04 ratio).
const full = { light, reverse };
for (const [tone, source] of Object.entries(full)) {
  await raster(source, 1200, 360).toFile(path.join(logoDir, `maw3ed-logo-${tone}-1200w.png`));
  for (const [w, h] of [[160, 48], [320, 96], [480, 144]]) {
    const out = path.join(logoDir, `email/maw3ed-email-logo-${tone}-${w}w.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await raster(source, w, h).toFile(out);
    fs.copyFileSync(out, path.join(root, `public/brand/maw3ed-email-logo-${tone}-${w}w.png`));
  }
}

// An icon centred on a square canvas: `scale` is the icon's share of the side; `bg` null = transparent.
async function iconOnSquare(size, scale, bg, source = iconLight) {
  const inner = Math.round(size * scale);
  const icon = await raster(source, inner, inner).toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: icon, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }])
    .png({ compressionLevel: 9 });
}

// App icons. "any" = the icon on transparent with a small margin; the maskable one keeps the icon inside the
// 60 % safe zone on a solid navy square (the reverse icon, so its body stays visible on navy); Apple wants an
// opaque square, so white.
await (await iconOnSquare(192, 0.92, null)).toFile(path.join(root, 'public/brand/app-icon-192.png'));
await (await iconOnSquare(512, 0.92, null)).toFile(path.join(root, 'public/brand/app-icon-512.png'));
await (await iconOnSquare(512, 0.6, NAVY, iconReverse)).toFile(path.join(root, 'public/brand/app-icon-maskable-512.png'));
await (await iconOnSquare(180, 0.74, '#FFFFFF')).toFile(path.join(root, 'src/app/apple-icon.png'));
for (const [name, build] of [
  ['app/app-icon-192.png', await iconOnSquare(192, 0.92, null)],
  ['app/app-icon-512.png', await iconOnSquare(512, 0.92, null)],
  ['app/app-icon-1024.png', await iconOnSquare(1024, 0.92, null)],
  ['app/app-icon-maskable-512.png', await iconOnSquare(512, 0.6, NAVY, iconReverse)],
  ['app/apple-touch-icon-180.png', await iconOnSquare(180, 0.74, '#FFFFFF')],
  ['whatsapp-profile-640.png', await iconOnSquare(640, 0.62, '#FFFFFF')],
]) {
  const file = path.join(logoDir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await build.toFile(file);
}

// Favicons: the icon alone, almost edge to edge (16 px has no room for padding).
const favSizes = [16, 32, 48];
const favPngs = [];
for (const s of favSizes) {
  const buf = await (await iconOnSquare(s, 1, null)).toBuffer();
  favPngs.push(buf);
  fs.mkdirSync(path.join(logoDir, 'favicon'), { recursive: true });
  fs.writeFileSync(path.join(logoDir, `favicon/favicon-${s}.png`), buf);
}
fs.writeFileSync(path.join(logoDir, 'favicon/favicon.svg'), iconLight);
fs.writeFileSync(path.join(root, 'src/app/icon.svg'), iconLight);

// .ico container with PNG entries (no package needed): 6 byte header, 16 byte directory entries, then the images.
function ico(pngs, sizes) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((png, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], o);
    head.writeUInt8(sizes[i] === 256 ? 0 : sizes[i], o + 1);
    head.writeUInt16LE(1, o + 4); // planes
    head.writeUInt16LE(32, o + 6); // bits per pixel
    head.writeUInt32LE(png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs]);
}
const icoBuf = ico(favPngs, favSizes);
fs.writeFileSync(path.join(logoDir, 'favicon/favicon.ico'), icoBuf);
fs.writeFileSync(path.join(root, 'src/app/favicon.ico'), icoBuf);
console.log('logo assets written');

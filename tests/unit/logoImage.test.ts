import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { detectImageType } from '@/server/domain/imageType';
import { LOGO_MAX_INPUT_BYTES, LOGO_SIZE, processLogo } from '@/server/services/logoImage';

const raw = (w: number, h: number, channels: 3 | 4 = 3) => {
  const data = Buffer.alloc(w * h * channels);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 251;
  return { data, info: { width: w, height: h, channels } };
};
const make = (w = 40, h = 30) => {
  const { data, info } = raw(w, h);
  return sharp(data, { raw: info });
};

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return `${(e as { code?: string }).code}:${(e as { status?: number }).status}`;
  }
  return 'ok';
}

describe('detectImageType (magic bytes)', () => {
  it('knows png, jpeg and webp', async () => {
    expect(detectImageType(await make().png().toBuffer())).toBe('png');
    expect(detectImageType(await make().jpeg().toBuffer())).toBe('jpeg');
    expect(detectImageType(await make().webp().toBuffer())).toBe('webp');
  });
  it('rejects everything else', () => {
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from('RIFF....WAVE'))).toBeNull();
  });
});

describe('processLogo', () => {
  it('outputs a 256x256 webp with a sha256 of the stored bytes', async () => {
    const out = await processLogo(await make(400, 200).jpeg().toBuffer());
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(LOGO_SIZE);
    expect(meta.height).toBe(LOGO_SIZE);
    expect(out.mime).toBe('image/webp');
    expect(out.width).toBe(256);
    expect(out.height).toBe(256);
    expect(out.hash).toBe(createHash('sha256').update(out.bytes).digest('hex'));
    expect(out.bytes.length).toBeLessThanOrEqual(150 * 1024);
  });

  it('accepts png (keeping alpha) and webp inputs', async () => {
    const { data, info } = raw(64, 64, 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 100;
    const png = await sharp(data, { raw: info }).png().toBuffer();
    const out = await processLogo(png);
    expect((await sharp(out.bytes).metadata()).hasAlpha).toBe(true);
    const out2 = await processLogo(await make().webp().toBuffer());
    expect(out2.width).toBe(256);
  });

  it('centre-crops a wide image to a square', async () => {
    const w = 300;
    const h = 100;
    const data = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3;
        const c = x < 100 ? [255, 0, 0] : x < 200 ? [0, 255, 0] : [0, 0, 255];
        data[o] = c[0]!;
        data[o + 1] = c[1]!;
        data[o + 2] = c[2]!;
      }
    const png = await sharp(data, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const out = await processLogo(png);
    const px = await sharp(out.bytes).removeAlpha().raw().toBuffer();
    const mid = (128 * 256 + 128) * 3;
    expect(px[mid + 1]).toBeGreaterThan(200);
    expect(px[mid]).toBeLessThan(60);
  });

  it('strips EXIF, GPS and ICC metadata', async () => {
    const withMeta = await make(200, 200)
      .withExif({ IFD0: { Copyright: 'FAKE-OWNER' } })
      .withIccProfile('srgb')
      .jpeg()
      .toBuffer();
    const before = await sharp(withMeta).metadata();
    expect(before.exif).toBeDefined();
    const out = await processLogo(withMeta);
    const after = await sharp(out.bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(out.bytes.includes(Buffer.from('FAKE-OWNER'))).toBe(false);
  });

  it('applies the EXIF orientation before cropping', async () => {
    const jpg = await make(200, 100).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const out = await processLogo(jpg);
    expect(out.width).toBe(256);
    expect(out.height).toBe(256);
  });

  it('takes the first frame of an animated image', async () => {
    const frameH = 40;
    const frames = Buffer.concat([
      Buffer.alloc(40 * frameH * 3, 255),
      Buffer.alloc(40 * frameH * 3, 0),
    ]);
    const anim = await sharp(frames, {
      raw: { width: 40, height: frameH * 2, channels: 3, pageHeight: frameH },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(anim, { animated: true }).metadata()).pages).toBe(2);
    const out = await processLogo(anim);
    expect((await sharp(out.bytes, { animated: true }).metadata()).pages ?? 1).toBe(1);
    const px = await sharp(out.bytes).removeAlpha().raw().toBuffer();
    expect(px[0]).toBeGreaterThan(240);
  });

  it('caps the stored size by lowering the quality', async () => {
    const noise = Buffer.alloc(512 * 512 * 3);
    let seed = 7;
    for (let i = 0; i < noise.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise[i] = seed >> 16;
    }
    const png = await sharp(noise, { raw: { width: 512, height: 512, channels: 3 } })
      .png()
      .toBuffer();
    const out = await processLogo(png);
    expect(out.bytes.length).toBeLessThanOrEqual(150 * 1024);
  });

  it('rejects gif, svg, text, tiff and unknown bytes as UNSUPPORTED_IMAGE (400)', async () => {
    expect(await codeOf(processLogo(Buffer.from('GIF89a\x01\x00\x01\x00', 'binary')))).toBe(
      'UNSUPPORTED_IMAGE:400',
    );
    expect(
      await codeOf(
        processLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')),
      ),
    ).toBe('UNSUPPORTED_IMAGE:400');
    expect(await codeOf(processLogo(Buffer.from('hello world')))).toBe('UNSUPPORTED_IMAGE:400');
    expect(await codeOf(processLogo(Buffer.alloc(0)))).toBe('UNSUPPORTED_IMAGE:400');
    expect(await codeOf(processLogo(await make().tiff().toBuffer()))).toBe('UNSUPPORTED_IMAGE:400');
    expect(await codeOf(processLogo(Buffer.from('\0\0\0\x1cftypavif\0\0\0\0avifmif1')))).toBe(
      'UNSUPPORTED_IMAGE:400',
    );
  });

  it('a polyglot (valid image + trailing HTML/script and ZIP bytes) is stored as a clean WebP with no trailing payload', async () => {
    const trailer = Buffer.concat([
      Buffer.from('<html><script>alert(1)</script></body>'),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('PK-ZIP-PAYLOAD-MARKER'),
      Buffer.alloc(64, 0x41),
    ]);
    const bases = {
      png: await make(120, 90).png().toBuffer(),
      jpeg: await make(120, 90).jpeg().toBuffer(),
      webp: await make(120, 90).webp().toBuffer(),
    };
    for (const [type, base] of Object.entries(bases)) {
      // WebP carries a RIFF size, so appended bytes sit outside it; PNG/JPEG simply have bytes after the end marker.
      const out = await processLogo(Buffer.concat([base, trailer]));
      const b = out.bytes;
      expect(b.subarray(0, 4).toString('latin1'), type).toBe('RIFF');
      expect(b.subarray(8, 12).toString('latin1'), type).toBe('WEBP');
      expect(b.readUInt32LE(4) + 8, `${type}: nothing after the declared RIFF size`).toBe(b.length);
      for (const marker of ['<html', '<script', 'alert', 'PK-ZIP', 'MARKER'])
        expect(b.includes(Buffer.from(marker)), `${type} contains ${marker}`).toBe(false);
      expect(b.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04])), `${type} zip header`).toBe(false);
    }
  });

  it('rejects a truncated or corrupt file as INVALID_IMAGE (400)', async () => {
    const png = await make(300, 300).png().toBuffer();
    expect(await codeOf(processLogo(png.subarray(0, 40)))).toBe('INVALID_IMAGE:400');
    const jpg = await make(300, 300).jpeg().toBuffer();
    const broken = Buffer.concat([jpg.subarray(0, 20), Buffer.alloc(60, 1)]);
    expect(await codeOf(processLogo(broken))).toBe('INVALID_IMAGE:400');
  });

  it('rejects a decompression bomb (huge dimensions) and oversize input', async () => {
    // 6000x6000 = 36 MP of one colour compresses to a few KB: over the 25 MP pixel cap.
    const bomb = await sharp({
      create: { width: 6000, height: 6000, channels: 3, background: '#fff' },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(LOGO_MAX_INPUT_BYTES);
    expect(await codeOf(processLogo(bomb))).toBe('INVALID_IMAGE:400');
    const big = Buffer.concat([await make().png().toBuffer(), Buffer.alloc(LOGO_MAX_INPUT_BYTES)]);
    expect(await codeOf(processLogo(big))).toBe('IMAGE_TOO_LARGE:400');
  });
});

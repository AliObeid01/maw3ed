import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { detectImageType } from '@/server/domain/imageType';
import { AppError } from '@/server/http/errors';

export const LOGO_SIZE = 256;
/** Largest accepted upload, in bytes, before decoding. */
export const LOGO_MAX_INPUT_BYTES = 3 * 1024 * 1024;
/** Decompression-bomb guard: sharp refuses to decode more pixels than this (25 megapixels). */
export const LOGO_MAX_INPUT_PIXELS = 25_000_000;
/** The stored image never exceeds this. */
export const LOGO_MAX_STORED_BYTES = 150 * 1024;
const QUALITIES = [82, 74, 66, 58, 50, 42, 34];

// Uploads are rare and limited (10 per hour per IP): one libvips thread and no operation cache keep the memory of
// a serverless instance small and predictable.
sharp.concurrency(1);
sharp.cache(false);

export interface ProcessedLogo {
  bytes: Buffer;
  mime: 'image/webp';
  width: number;
  height: number;
  /** sha256 hex of `bytes`; the public version of the logo. */
  hash: string;
}

const unsupported = () =>
  new AppError(400, 'UNSUPPORTED_IMAGE', 'Use a PNG, JPEG or WebP image.', {
    image: 'Use a PNG, JPEG or WebP image.',
  });
const invalid = () =>
  new AppError(400, 'INVALID_IMAGE', 'That image could not be read. Try another file or export it again from an image editor.', {
    image: 'That image could not be read. Try another file or export it again from an image editor.',
  });
const tooLarge = () =>
  new AppError(400, 'IMAGE_TOO_LARGE', 'The image is larger than 3 MB.', {
    image: 'The image is larger than 3 MB.',
  });

/**
 * Turns an upload into the one stored form: a 256x256 WebP, EXIF/GPS/ICC removed, orientation applied, centre
 * cover crop, first frame of animations, at most 150 KB. The type comes from the magic bytes only; a decoder
 * failure (truncated, corrupt, too many pixels) is INVALID_IMAGE.
 */
export async function processLogo(input: Buffer): Promise<ProcessedLogo> {
  if (input.length > LOGO_MAX_INPUT_BYTES) throw tooLarge();
  if (detectImageType(input) === null) throw unsupported();
  try {
    // No `animated`: only the first frame is read. `failOn: 'warning'` is what rejects truncated files; the price
    // is that a few JPEGs that merely carry a decoder warning are refused too, hence the "export it again" message.
    const base = sharp(input, {
      limitInputPixels: LOGO_MAX_INPUT_PIXELS,
      failOn: 'warning',
      pages: 1,
    })
      .autoOrient()
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'cover', position: 'centre' });
    let bytes: Buffer = Buffer.alloc(0);
    for (const quality of QUALITIES) {
      // sharp drops all metadata unless asked (no keepMetadata call), so EXIF, GPS and ICC go.
      bytes = await base.clone().webp({ quality, effort: 4 }).toBuffer();
      if (bytes.length <= LOGO_MAX_STORED_BYTES) break;
    }
    if (bytes.length > LOGO_MAX_STORED_BYTES) throw invalid();
    return {
      bytes,
      mime: 'image/webp',
      width: LOGO_SIZE,
      height: LOGO_SIZE,
      hash: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw invalid();
  }
}

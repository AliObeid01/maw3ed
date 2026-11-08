/** Client side of the logo upload: a quick type / size check and a downscale before sending. The server re-encodes. */

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';
export const LOGO_MAX_FILE_BYTES = 3 * 1024 * 1024;
/** The picture is cropped to a square from the centre and scaled to at most this many pixels a side. */
export const LOGO_MAX_SIDE = 512;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export type LogoFileProblem = 'unsupported' | 'tooLarge';

/** A hint for fast feedback only: the declared type can lie, so the server judges the real bytes. */
export function checkLogoFile(file: { type: string; size: number }): LogoFileProblem | null {
  if (!ALLOWED.has(file.type)) return 'unsupported';
  if (file.size > LOGO_MAX_FILE_BYTES) return 'tooLarge';
  return null;
}

export interface CropPlan {
  /** Source rectangle: the centred square. */
  sx: number;
  sy: number;
  side: number;
  /** Output size in pixels (square). */
  out: number;
}

/** Centre square of a width x height picture, scaled down (never up) to at most `maxSide`. */
export function cropPlan(width: number, height: number, maxSide = LOGO_MAX_SIDE): CropPlan {
  const side = Math.max(1, Math.min(width, height));
  return {
    sx: Math.floor((width - side) / 2),
    sy: Math.floor((height - side) / 2),
    side,
    out: Math.min(side, maxSide),
  };
}

export interface PreparedLogo {
  base64: string;
  previewUrl: string;
}

/** Decode, centre-crop and downscale in a canvas. Throws when the browser cannot decode the file. */
export async function prepareLogo(file: File): Promise<PreparedLogo> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const plan = cropPlan(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = plan.out;
    canvas.height = plan.out;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, plan.sx, plan.sy, plan.side, plan.side, 0, 0, plan.out, plan.out);
    // WebP keeps alpha and is small; a browser without WebP encoding hands back a PNG, which the server also accepts.
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/webp', 0.9),
    );
    const base64 = await blobToBase64(blob);
    return { base64, previewUrl: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const text = String(reader.result);
      resolve(text.slice(text.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

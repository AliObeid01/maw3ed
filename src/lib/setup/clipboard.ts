/** Copies text. Uses the async Clipboard API when available, otherwise a hidden textarea. Returns success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // permission denied or insecure context: fall through to the legacy path
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.insetBlockStart = '0';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Public booking address shown to owners, e.g. `maw3ed.com/b/studio-nour` (no protocol). */
export function bookingUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/b/${slug}`;
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** WhatsApp "share with text" link. */
export function whatsappShareUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

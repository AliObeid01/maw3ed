const TOKEN = /^[A-Za-z0-9_-]{1,400}\.[A-Za-z0-9_-]{1,200}$/;

/**
 * The signed token out of what a person pasted: a bare token, or a manage link like
 * `https://maw3ed.example/l/<token>?x=1#y` (also `/en/l/<token>` style prefixes). Returns null when nothing
 * token-shaped is found. This only finds the string; the signature is verified by the caller. Pure.
 */
export function extractLinkToken(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 2000) return null;
  if (TOKEN.test(text)) return text;
  let path: string;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    path = url.pathname;
  } catch {
    // A bare path such as "/l/<token>".
    if (!text.startsWith('/')) return null;
    path = text.split(/[?#]/)[0] ?? '';
  }
  const segments = path.split('/').filter(Boolean);
  const at = segments.lastIndexOf('l');
  const candidate = at >= 0 ? segments[at + 1] : undefined;
  return candidate && TOKEN.test(candidate) ? candidate : null;
}

import type { Metadata } from 'next';

/** The public origin, when the deployment configures one. Without it no canonical URL is emitted (never a wrong host). */
function publicBase(): URL | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (!raw) return undefined;
  try {
    return new URL(raw);
  } catch {
    return undefined;
  }
}

/** Title, description, canonical (when the origin is known) and Open Graph basics for one public page. */
export function pageMetadata(input: { title: string; description: string; path: string; siteName: string }): Metadata {
  const base = publicBase();
  return {
    title: input.title,
    description: input.description,
    ...(base ? { metadataBase: base, alternates: { canonical: input.path } } : {}),
    openGraph: {
      title: input.title,
      description: input.description,
      siteName: input.siteName,
      type: 'website',
      ...(base ? { url: input.path } : {}),
    },
  };
}

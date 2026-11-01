import { useTranslations } from 'next-intl';
import type { CategoryKey } from '@/i18n/keys';

const letters = (text: string) => text.toLowerCase().replace(/[^a-z]+/g, '');

/**
 * Message-key candidates for a free-text business category, best first: the whole text without spaces, then each
 * word ("Hair Salon" -> ["hairsalon", "hair", "salon"], "salon " -> ["salon"]). Empty or non-Latin text gives [].
 */
export function categoryKeys(category: string | null | undefined): string[] {
  const text = (category ?? '').trim();
  if (!text) return [];
  const candidates = [letters(text), ...text.split(/\s+/).map(letters)].filter(Boolean);
  return [...new Set(candidates)];
}

/** First candidate key that has a translation, or null. */
export function categoryKey(
  category: string | null | undefined,
  has: (key: string) => boolean,
): string | null {
  return categoryKeys(category).find(has) ?? null;
}

/** The translated label, or the text exactly as the owner typed it when no key matches. */
export function categoryText(
  category: string | null | undefined,
  has: (key: string) => boolean,
  label: (key: string) => string,
): string | null {
  const text = (category ?? '').trim();
  if (!text) return null;
  const key = categoryKey(text, has);
  return key ? label(key) : text;
}

/** Translated label for a business category; unknown categories are shown as the owner typed them. */
export function useCategoryLabel() {
  const t = useTranslations('public.category');
  return (category: string | null | undefined): string | null =>
    categoryText(
      category,
      // `key` comes from free text: `has` is the runtime check that it exists, so the cast is sound.
      (key) => t.has(key as CategoryKey),
      (key) => t(key as CategoryKey),
    );
}

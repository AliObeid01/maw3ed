import { useTranslations } from 'next-intl';

/** Normalises the free-text business category ("Hair Salon", "salon ") to a message key, or null. */
export function categoryKey(category: string | null | undefined): string | null {
  const key = (category ?? '').trim().toLowerCase().replace(/[^a-z]+/g, '');
  return key || null;
}

/** Translated label for a business category; unknown categories are shown as the owner typed them. */
export function useCategoryLabel() {
  const t = useTranslations('public.category');
  return (category: string | null | undefined): string | null => {
    const key = categoryKey(category);
    if (!key) return null;
    return t.has(key) ? t(key) : (category?.trim() ?? null);
  };
}

import { useTranslations } from 'next-intl';
import { isAreaKey } from '@/lib/business/profile';

/** Translated area name for an area key; null when the business has none (or an unknown value). */
export function useAreaLabel() {
  const t = useTranslations('public.area');
  return (area: string | null | undefined): string | null => (isAreaKey(area) ? t(area) : null);
}

/** "Category · Area" under a business name; null when neither is set. */
export function profileLine(category: string | null, area: string | null): string | null {
  const parts = [category, area].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' · ') : null;
}

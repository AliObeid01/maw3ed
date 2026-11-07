import { isAreaKey } from '@/lib/business/profile';
import { cleanSearchParam } from '@/lib/directory/params';

/** Popular chips on the hero: message keys under `home.hero.popular`; the Latin value is the directory search text. */
export const POPULAR_SEARCHES = ['haircut', 'dental', 'massage', 'hydrafacial'] as const;

/** The home search card submits here. Param order is fixed (search, area) so the URL is the same for everyone. */
export function buildDirectoryUrl({ search = '', area = '' }: { search?: string; area?: string }): string {
  const q = new URLSearchParams();
  const text = cleanSearchParam(search);
  if (text) q.set('search', text);
  if (isAreaKey(area) && area !== 'other') q.set('area', area);
  const qs = q.toString();
  return qs ? `/directory?${qs}` : '/directory';
}

/** A popular service of a category: the directory filtered by category, then by the service name. */
export function categoryServiceUrl(category: string, service?: string): string {
  const q = new URLSearchParams({ category });
  const text = cleanSearchParam(service);
  if (text) q.set('search', text);
  return `/directory?${q.toString()}`;
}

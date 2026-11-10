// The one place that draws a business-category icon (home category list; add new surfaces here, not inline).
// Six outline icons copied as inline SVG from two permissively licensed sets, all on the same 24 px grid with the
// same stroke style (stroke 2, round caps and joins, currentColor), so they sit together like one family:
//   barbers  tabler "razor-electric"   hair salons  tabler "scissors"      dental clinics  tabler "dental"
//   beauty clinics  tabler "vaccine"   spa & massage  lucide "flower-2"    physiotherapy  tabler "stretching"
// Tabler Icons is MIT (c) Pawel Kuna, Lucide is ISC (c) Lucide Icons and Contributors: see THIRD_PARTY_NOTICES.md.
// An unknown key (and "other") gets a neutral rounded-square fallback. Icons are never mirrored under RTL.
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  barbers: (
    <>
      <path d="M8 3v2" />
      <path d="M12 3v2" />
      <path d="M16 3v2" />
      <path d="M9 12v6a3 3 0 0 0 6 0v-6h-6" />
      <path d="M8 5h8l-1 4h-6l-1 -4" />
      <path d="M12 17v1" />
    </>
  ),
  'hair-salons': (
    <>
      <path d="M3 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M3 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M8.6 8.6l10.4 10.4" />
      <path d="M8.6 15.4l10.4 -10.4" />
    </>
  ),
  'dental-clinics': (
    <>
      <path d="M12 5.5c-1.074 -.586 -2.583 -1.5 -4 -1.5c-2.1 0 -4 1.247 -4 5c0 4.899 1.056 8.41 2.671 10.537c.573 .756 1.97 .521 2.567 -.236c.398 -.505 .819 -1.439 1.262 -2.801c.292 -.771 .892 -1.504 1.5 -1.5c.602 0 1.21 .737 1.5 1.5c.443 1.362 .864 2.295 1.262 2.8c.597 .759 2 .993 2.567 .237c1.615 -2.127 2.671 -5.637 2.671 -10.537c0 -3.74 -1.908 -5 -4 -5c-1.423 0 -2.92 .911 -4 1.5" />
      <path d="M12 5.5l3 1.5" />
    </>
  ),
  'beauty-clinics': (
    <>
      <path d="M17 3l4 4" />
      <path d="M19 5l-4.5 4.5" />
      <path d="M11.5 6.5l6 6" />
      <path d="M16.5 11.5l-6.5 6.5h-4v-4l6.5 -6.5" />
      <path d="M7.5 12.5l1.5 1.5" />
      <path d="M10.5 9.5l1.5 1.5" />
      <path d="M3 21l3 -3" />
    </>
  ),
  'spa-massage': (
    <>
      <path d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1" />
      <circle cx="12" cy="8" r="2" />
      <path d="M12 10v12" />
      <path d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z" />
      <path d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z" />
    </>
  ),
  physiotherapy: (
    <>
      <path d="M15 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" />
      <path d="M5 20l5 -.5l1 -2" />
      <path d="M18 20v-5h-5.5l2.5 -6.5l-5.5 1l1.5 2" />
    </>
  ),
  other: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
};

/** Category keys that have their own icon (everything else shows the fallback). */
export const CATEGORY_ICON_KEYS = Object.keys(ICONS).filter((k) => k !== 'other');

export function CategoryIcon({ category, size = 24, className }: { category: string; size?: number; className?: string }) {
  const key = Object.hasOwn(ICONS, category) ? category : 'other';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-category={key}
      className={className}
    >
      {ICONS[key]}
    </svg>
  );
}

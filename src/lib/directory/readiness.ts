import type { SetupFlags } from '@/lib/api/setup';
import { profileMissing } from '@/lib/business/profile';

export type DirectoryChecklistId = 'services' | 'staff' | 'hours';

export type DirectoryChecklistItem = { id: DirectoryChecklistId; done: boolean; href: string };

/** What a business needs before it may list itself (mirrors the server's 409 NOT_READY rule). */
export function directoryChecklist(flags: SetupFlags): DirectoryChecklistItem[] {
  return [
    { id: 'services', done: flags.hasServices, href: '/app/services' },
    { id: 'staff', done: flags.hasBookableStaff, href: '/app/staff' },
    { id: 'hours', done: flags.hasHours, href: '/app/hours' },
  ];
}

/** True when the business still has to choose a category and an area before it may list (PR-1). */
export function profileIncomplete(business: {
  category: string | null;
  area: string | null;
}): boolean {
  return profileMissing(business).length > 0;
}

const KNOWN: readonly string[] = ['services', 'staff', 'hours'];

/** The `missing` list of a 409 NOT_READY, limited to items we have a label for. Empty for any other error. */
export function missingFromError(error: { code: string; data?: unknown }): DirectoryChecklistId[] {
  if (error.code !== 'NOT_READY') return [];
  const missing = (error.data as { missing?: unknown } | undefined)?.missing;
  if (!Array.isArray(missing)) return [];
  return missing.filter((m): m is DirectoryChecklistId => KNOWN.includes(m as string));
}

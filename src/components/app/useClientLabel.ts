'use client';

import { useTranslations } from 'next-intl';
import { isDeletedClient } from '@/lib/dashboard/phone';

/** Name to show for a client: the localized "Deleted client" for an anonymised one (its stored name is English). */
export function useClientLabel() {
  const t = useTranslations('app.shared');
  return (client: { name: string; phone: string }): string =>
    isDeletedClient(client.phone) ? t('deletedClient') : client.name;
}

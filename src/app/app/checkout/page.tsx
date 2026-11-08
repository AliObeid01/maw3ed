import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CheckoutView } from '@/components/billing/CheckoutView';
import { assertPractitionerPath } from '@/app/app/practitionerGuard';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('billing.checkout');
  return { title: t('pageTitle') };
}

/**
 * Owner-only (a receptionist sees the friendly owner-only state; a barber is redirected to Today by the guard, because
 * this path is not on their allow-list). `?plan=pro` is accepted and ignored: Pro is the only plan on sale.
 */
export default async function CheckoutPage() {
  await assertPractitionerPath('/app/checkout');
  return <CheckoutView />;
}

import { notFound } from 'next/navigation';
import { ScopedIntl } from '@/components/i18n/ScopedIntl';

/**
 * Safety net: nothing under (dev) is ever served in production, even if a page forgets its own guard.
 * It is also the only route group that receives the `dev.*` messages (the `dev` scope, all namespaces).
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ScopedIntl scope="dev">{children}</ScopedIntl>;
}

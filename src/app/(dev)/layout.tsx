import { notFound } from 'next/navigation';

/** Safety net: nothing under (dev) is ever served in production, even if a page forgets its own guard. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}

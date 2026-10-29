import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';

/** Shared frame for the public booking page and the signed-link pages: header, content, footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  );
}

import { ScopedIntl } from '@/components/i18n/ScopedIntl';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';

/** Shared frame for the public booking page and the signed-link pages: header, content, footer. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <ScopedIntl scope="public">
      <div id="top" className="flex min-h-dvh flex-col">
        <PublicHeader />
        {children}
        <PublicFooter />
      </div>
    </ScopedIntl>
  );
}

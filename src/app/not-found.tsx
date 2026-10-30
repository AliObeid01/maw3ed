import { Compass } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PageState } from '@/components/public/PageState';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { ButtonLink } from '@/components/ui/Button';

/** Global branded 404: header, a status card with a heading and a way home, footer. */
export default async function NotFound() {
  const t = await getTranslations('notFound');
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <PageState
        icon={<Compass size={26} />}
        title={t('title')}
        body={t('body')}
        action={
          <ButtonLink href="/" size="lg" block>
            {t('action')}
          </ButtonLink>
        }
      />
      <PublicFooter />
    </div>
  );
}

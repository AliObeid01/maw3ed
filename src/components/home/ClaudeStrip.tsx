import { ArrowRight, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PendingLink as Link } from '@/components/public/PendingLink';

/**
 * A slim, calm pointer to /assistant on the home page, between the hero and "Browse by category". Server-rendered
 * and static (no motion, no client code). The caller renders it only while `isAssistantEnabled()`.
 */
export function ClaudeStrip() {
  const t = useTranslations('home.claude');
  return (
    <section aria-labelledby="claude-strip-title" data-testid="claude-strip" className="mx-auto max-w-[1200px] px-4 pt-6 md:px-6 md:pt-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[22px] border-[1.5px] border-divider bg-surface p-4 md:px-5">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-mint/20">
          <MessageCircle size={22} />
        </span>
        <div className="min-w-0 flex-[1_1_220px]">
          <h2 id="claude-strip-title" className="m-0 text-[17px] leading-tight font-semibold">
            {t('title')}
          </h2>
          <p className="m-0 mt-0.5 text-[15px] text-muted">{t('body')}</p>
        </div>
        <Link
          href="/assistant"
          data-testid="claude-strip-link"
          className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-brand no-underline hover:underline aria-busy:opacity-60"
        >
          {t('link')}
          <ArrowRight size={16} aria-hidden="true" className="rtl:-scale-x-100" />
        </Link>
      </div>
    </section>
  );
}

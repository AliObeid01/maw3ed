import { Check, Clock, Search, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DemoPlayer } from './DemoPlayer';

const bubble = 'max-w-[88%] rounded-[18px] px-3.5 py-2.5 text-[15px] leading-snug';
const user = `${bubble} justify-self-end rounded-ee-[6px] bg-brand text-white`;
const claude = `${bubble} justify-self-start rounded-es-[6px] border border-divider bg-canvas text-ink`;
const chip =
  'inline-flex items-center gap-1.5 rounded-pill border border-divider bg-surface px-2.5 py-1 text-[13px] font-medium text-muted';

/**
 * A decorative, made-up conversation on /assistant ("Illustration"): fake business, staff and client names, never a
 * real chat. The whole card is `aria-hidden`; the heading and the sentence above it tell everyone it is made up.
 * Eight steps appear one after another (see DemoPlayer and the `data-demo-step` rules in globals.css).
 */
export function AssistantDemo() {
  const t = useTranslations('assistant.demo');
  const names = { business: t('business'), staff: t('staff'), client: t('client') };
  const n = (chunks: React.ReactNode) => <bdi className="font-semibold">{chunks}</bdi>;
  return (
    <section aria-labelledby="demo-title" className="mt-12 max-w-[760px]" data-testid="assistant-demo">
      <h2 id="demo-title" className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
        {t('title')}
      </h2>
      <p className="m-0 mt-2 max-w-[60ch] text-[15.5px] text-muted">{t('intro')}</p>
      <DemoPlayer className="mt-5 grid w-full max-w-[420px] gap-3 rounded-[22px] border-[1.5px] border-divider bg-surface p-[18px]">
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-chip bg-divider px-2.5 py-1 text-xs font-semibold" data-testid="demo-label">
            {t('label')}
          </span>
        </div>
        <p className={`m-0 ${user}`} data-demo-step="0">
          {t('ask')}
        </p>
        <div className="flex flex-wrap gap-2">
          <span className={chip} data-demo-step="1">
            <Search size={14} aria-hidden="true" />
            {t('searching')}
          </span>
          <span className={chip} data-demo-step="2">
            <Clock size={14} aria-hidden="true" />
            {t('checking')}
          </span>
        </div>
        <p className={`m-0 ${claude}`} data-demo-step="3">
          {t.rich('offer', { ...names, n })}
        </p>
        <p className={`m-0 ${user}`} data-demo-step="4">
          {t('pick')}
        </p>
        <div className="flex flex-wrap gap-2">
          <span className={chip} data-demo-step="5">
            <ShieldCheck size={14} aria-hidden="true" />
            {t('approval')}
          </span>
          <span className={chip} data-demo-step="6">
            <Check size={14} aria-hidden="true" />
            {t('booked')}
          </span>
        </div>
        <p className={`m-0 ${claude}`} data-demo-step="7">
          {t.rich('done', { ...names, n })}
        </p>
      </DemoPlayer>
    </section>
  );
}

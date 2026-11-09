import { ChevronDown, Link2, MessageCircle, Plug, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PendingLink as Link } from '@/components/public/PendingLink';
import { buttonClasses } from '@/components/ui/buttonStyles';
import { Reveal } from '@/components/ui/Reveal';
import { CopyField } from './CopyField';
import { PromptChips } from './PromptChips';

const STEPS = [
  { id: 'copy', Icon: Link2 },
  { id: 'add', Icon: Plug },
  { id: 'ask', Icon: MessageCircle },
] as const;
const FAQ = ['free', 'sees', 'which', 'cancel', 'deposit', 'remove'] as const;

/**
 * /assistant: how to add the Maw3ed connector to Claude and book by chatting. Server-rendered; only the copy field and
 * the example chips are client components. The FAQ is native `<details>` (works without JavaScript).
 */
export function AssistantPage({ connectorUrl }: { connectorUrl: string }) {
  const t = useTranslations('assistant');
  return (
    <section aria-labelledby="assistant-title" className="mx-auto max-w-[1200px] px-4 pt-12 pb-16 md:px-6 md:pt-[72px] md:pb-[88px]">
      <div className="max-w-[640px]">
        <span className="mb-2.5 inline-block text-[15px] font-bold text-brand">{t('kicker')}</span>
        <h1 id="assistant-title" className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
          {t('title')}
        </h1>
        <p className="m-0 mt-2 text-[17px] text-muted">{t('subtitle')}</p>
      </div>

      <h2 className="sr-only">{t('stepsTitle')}</h2>
      <ol className="m-0 mt-9 grid list-none gap-4 p-0 md:grid-cols-3">
        {STEPS.map(({ id, Icon }, i) => (
          <Reveal as="li" key={id} step={i} className="grid min-w-0 content-start gap-3 rounded-[22px] border-[1.5px] border-divider bg-surface p-[22px] md:p-[26px]">
            <div className="flex items-center justify-between">
              <span aria-hidden="true" className="grid size-[58px] place-items-center rounded-[18px] bg-mint/20">
                <Icon size={28} />
              </span>
              <span aria-hidden="true" className="grid size-[34px] place-items-center rounded-full bg-brand font-bold text-white">
                {i + 1}
              </span>
            </div>
            <h3 className="m-0 text-[21px] leading-tight font-semibold">
              <span className="sr-only">{t('step', { number: i + 1 })}: </span>
              {t(`steps.${id}.title`)}
            </h3>
            <p className="m-0 text-muted">{t(`steps.${id}.body`)}</p>
            {id === 'copy' ? <CopyField value={connectorUrl} /> : null}
            {id === 'ask' ? <PromptChips /> : null}
          </Reveal>
        ))}
      </ol>

      <p className="m-0 mt-5 max-w-[640px] text-[15.5px] text-muted" data-testid="assistant-requirements">
        {t('requirements')}
      </p>

      <Reveal>
        <div className="mt-12 flex max-w-[760px] items-start gap-3.5 rounded-[22px] border-[1.5px] border-divider bg-surface p-[22px]" data-testid="assistant-privacy">
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-mint/20">
            <ShieldCheck size={24} />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-[19px] leading-tight font-semibold">{t('privacyTitle')}</h2>
            <p className="m-0 mt-1.5 text-[15.5px] text-muted">{t('privacy')}</p>
            <Link href="/privacy" className="mt-1 inline-flex min-h-11 items-center text-[15px] font-semibold text-brand underline-offset-4 hover:underline">
              {t('privacyLink')}
            </Link>
          </div>
        </div>
      </Reveal>

      <div id="faq" className="mt-14 max-w-[760px] scroll-mt-4">
        <Reveal>
          <h2 className="m-0 text-[clamp(27px,4.4vw,38px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:tracking-normal">
            {t('faqTitle')}
          </h2>
          <div className="mt-4" data-testid="faq">
            {FAQ.map((id) => (
              <details key={id} className="group border-b border-line">
                <summary className="flex min-h-[58px] cursor-pointer list-none items-center justify-between gap-3 text-[17px] font-semibold [&::-webkit-details-marker]:hidden">
                  {t(`faq.${id}.q`)}
                  <ChevronDown
                    size={22}
                    aria-hidden="true"
                    className="shrink-0 text-brand transition-transform duration-200 ease-out group-open:rotate-180 motion-reduce:transition-none"
                  />
                </summary>
                <p className="m-0 max-w-[60ch] pb-[18px] text-muted">{t(`faq.${id}.a`)}</p>
              </details>
            ))}
          </div>
          <p className="m-0 mt-6 text-[15.5px] text-muted">{t('fallback')}</p>
          <Link href="/directory" className={buttonClasses({ variant: 'secondary', size: 'hero', className: 'mt-3' })}>
            {t('explore')}
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

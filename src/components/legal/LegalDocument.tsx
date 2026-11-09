import { FileWarning, Link2 } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { LegalToc } from './LegalToc';
import { isolate, ltr } from '@/components/ui/Bidi';
import { Callout } from '@/components/ui/Callout';
import { legalKeys, type LegalSection } from '@/lib/legal';
import { LEGAL_DRAFT, LEGAL_UPDATED, SITE } from '@/lib/site';

/** The "Draft - under review" notice: rendered only while `show` (the `LEGAL_DRAFT` switch in site.ts) is true. */
export function LegalDraftNotice({ show, title, body }: { show: boolean; title: string; body: string }) {
  if (!show) return null;
  return (
    <Callout tone="warning" icon={<FileWarning />} className="mt-5">
      <p role="note" data-testid="legal-draft" className="m-0">
        <b className="font-semibold">{title}.</b> {body}
      </p>
    </Callout>
  );
}

/**
 * Reading layout for the Privacy policy and the Terms: title, draft notice, last-updated date, a table of
 * contents on wide screens, and numbered sections with anchors. Server-rendered from `legal.<doc>`.
 */
export async function LegalDocument({ doc, sections }: { doc: 'privacy' | 'terms'; sections: LegalSection[] }) {
  const raw = await getTranslations('legal');
  // Section keys are computed from the section list (checked against both message files by tests/unit/home/legal.test.ts).
  const t = raw as unknown as (key: string, values?: Record<string, string>) => string;
  const format = await getFormatter();
  const updated = format.dateTime(new Date(`${LEGAL_UPDATED}T12:00:00Z`), {
    dateStyle: 'long',
    timeZone: 'Asia/Beirut',
    numberingSystem: 'latn',
  });
  // The address is displayed from the SAME message key as the footer (`public.footer.address`), so both languages agree.
  const address = (await getTranslations('public.footer'))('address');
  // Latin runs (email, phone) stay left to right inside Arabic text; the address follows its own first strong letter
  // (Arabic reads right to left, English left to right).
  const args = { email: ltr(SITE.email), phone: ltr(SITE.phone), address: isolate(address) };
  const key = (path: string) => `${doc}.sections.${path}`;

  return (
    <main id="main-content" className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-10 md:px-6 md:py-14">
      <header className="max-w-[760px]">
        <h1 className="m-0 text-[clamp(30px,5vw,44px)] leading-[1.12] font-bold tracking-[-0.02em] rtl:leading-[1.3] rtl:tracking-normal">
          {t(`${doc}.title`)}
        </h1>
        <p className="m-0 mt-3 text-[17px] text-muted">{t(`${doc}.intro`)}</p>
        <p className="m-0 mt-2 text-sm font-semibold text-muted">{t('common.updated', { date: updated })}</p>
        <LegalDraftNotice show={LEGAL_DRAFT} title={t('common.draftTitle')} body={t('common.draftBody')} />
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-14">
        <LegalToc title={t('common.toc')} items={sections.map((s) => ({ id: s.id, title: t(key(`${s.id}.title`)) }))} />

        <div className="grid max-w-[760px] gap-9">
          {sections.map((s) => (
            <section key={s.id} aria-labelledby={`h-${s.id}`}>
              <h2 id={s.id} className="m-0 mb-3 flex scroll-mt-4 items-center gap-2 text-[22px] leading-tight font-semibold">
                <span id={`h-${s.id}`}>{t(key(`${s.id}.title`))}</span>
                <a
                  href={`#${s.id}`}
                  aria-label={`${t('common.anchor')}: ${t(key(`${s.id}.title`))}`}
                  className="inline-grid size-11 place-items-center rounded-btn text-muted no-underline hover:text-brand"
                >
                  <Link2 size={18} aria-hidden="true" />
                </a>
              </h2>
              <div className="grid gap-3 text-base leading-[1.65] text-ink">
                {renderBlocks(s, (k) => t(key(`${s.id}.${k}`), args))}
              </div>
            </section>
          ))}
          <p className="m-0 flex flex-wrap gap-x-5 border-t border-divider pt-5">
            <Link href="/" className="inline-flex min-h-11 items-center font-semibold text-brand no-underline hover:underline">
              {t('common.home')}
            </Link>
            <Link
              href={doc === 'privacy' ? '/terms' : '/privacy'}
              className="inline-flex min-h-11 items-center font-semibold text-brand no-underline hover:underline"
            >
              {doc === 'privacy' ? t('common.otherTerms') : t('common.otherPrivacy')}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

/** Paragraphs and bullet lists in the order `legalKeys` gives: consecutive `bN` keys become one list. */
function renderBlocks(s: LegalSection, text: (k: string) => string) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="m-0 grid list-disc gap-1.5 ps-6">
        {bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const k of legalKeys(s)) {
    if (k.startsWith('b')) bullets.push(text(k));
    else {
      flush();
      blocks.push(<p key={k} className="m-0">{text(k)}</p>);
    }
  }
  flush();
  return blocks;
}
